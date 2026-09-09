const CONFIG = {
  SPREADSHEET_ID: '11j1cRxIDCZ_mrbfUuZFsVSpg_CisY8R5YmjU2_DT0aM',
  DRIVER_SHEET: 'Driver',
  MANAGED_SHEET: '_DRIVER_MANAGED',
  COMPLAINTS_SHEET: 'Complaints'
};

function getSS_() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🚚 COACH')
    .addItem('🔄 UPDATE DRIVER', 'UPDATE_DRIVER')
    .addSeparator()
    .addItem('🗂️ PREPARE DATABASE', 'PREPARE_DATABASE')
    .addToUi();
}

function doGet() {
  PREPARE_DATABASE();
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('COACH')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function PREPARE_DATABASE() {
  const ss = getSS_();
  let sh = ss.getSheetByName(CONFIG.COMPLAINTS_SHEET);
  if (!sh) sh = ss.insertSheet(CONFIG.COMPLAINTS_SHEET);

  const headers = ['ID', 'ADDRESS', 'NORMALIZED_ADDRESS', 'DETAILS', 'DATE', 'ACTIVE'];
  const current = sh.getRange(1, 1, 1, headers.length).getDisplayValues()[0];

  if (current.join('|') !== headers.join('|')) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  sh.setColumnWidth(1, 170);
  sh.setColumnWidth(2, 320);
  sh.setColumnWidth(3, 320);
  sh.setColumnWidth(4, 420);
  sh.setColumnWidth(5, 150);
  sh.setColumnWidth(6, 90);

  return true;
}

/**
 * HOME data:
 * 1) Reads active complaint addresses from Complaints.
 * 2) Reads each driver listed in Driver!A2:A.
 * 3) In each driver's sheet, only extracts STOP + ADDRESS from column A.
 * 4) Matches normalized route addresses against the complaint database.
 */
function getHomeData() {
  PREPARE_DATABASE();

  const ss = getSS_();
  const complaints = getActiveComplaints_(ss);
  const complaintMap = new Map();

  complaints.forEach(c => complaintMap.set(c.normalizedAddress, c));

  const drivers = getDriverNames_(ss);
  const alerts = [];

  drivers.forEach(driver => {
    const sh = ss.getSheetByName(driver);
    if (!sh || sh.getLastRow() < 1) return;

    const routeStops = parseDriverRoute_(sh);

    routeStops.forEach(route => {
      const normalized = normalizeAddress_(route.address);
      const complaint = complaintMap.get(normalized);
      if (!complaint) return;

      alerts.push({
        driver: driver,
        stop: route.stop,
        address: route.address,
        details: complaint.details,
        complaintAddress: complaint.address,
        complaintId: complaint.id
      });
    });
  });

  alerts.sort((a, b) => {
    const driverCompare = a.driver.localeCompare(b.driver);
    if (driverCompare !== 0) return driverCompare;
    return Number(a.stop) - Number(b.stop);
  });

  const recent = complaints
    .slice(-8)
    .reverse()
    .map(c => ({
      id: c.id,
      address: c.address,
      details: c.details,
      date: c.date
    }));

  const driversWithAlerts = [...new Set(alerts.map(a => a.driver))];

  return {
    totalComplaints: complaints.length,
    alerts: alerts,
    recent: recent,
    drivers: drivers,
    driversWithAlerts: driversWithAlerts,
    routeMatchingReady: true
  };
}

function getActiveComplaints_(ss) {
  const sh = ss.getSheetByName(CONFIG.COMPLAINTS_SHEET);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  return sh.getRange(2, 1, lastRow - 1, 6).getDisplayValues()
    .filter(r => cleanText_(r[1]) && String(r[5]).toUpperCase() !== 'FALSE')
    .map(r => ({
      id: r[0],
      address: r[1],
      normalizedAddress: r[2] || normalizeAddress_(r[1]),
      details: r[3],
      date: r[4]
    }));
}

function getDriverNames_(ss) {
  const sh = ss.getSheetByName(CONFIG.DRIVER_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];

  return [...new Set(
    sh.getRange(2, 1, sh.getLastRow() - 1, 1)
      .getDisplayValues()
      .flat()
      .map(cleanText_)
      .filter(Boolean)
  )];
}

/**
 * Route format example in column A:
 * 3
 * 2721 Apache Ave
 * CX143
 * 1/1 delivery Front door...
 * (Planned ...)
 *
 * We ONLY care about the numeric stop and the address immediately after it.
 * Lines such as CX143, delivery details, Planned, pickups and Multi-location stop
 * are ignored.
 */
function parseDriverRoute_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const lines = sheet.getRange(1, 1, lastRow, 1)
    .getDisplayValues()
    .flat()
    .map(v => cleanText_(v));

  const stops = [];

  for (let i = 0; i < lines.length; i++) {
    const current = lines[i];
    if (!/^\d+$/.test(current)) continue;

    let j = i + 1;
    while (j < lines.length && !lines[j]) j++;
    if (j >= lines.length) continue;

    const address = lines[j];
    if (!looksLikeStreetAddress_(address)) continue;

    stops.push({
      stop: Number(current),
      address: address
    });
  }

  return stops;
}

function looksLikeStreetAddress_(value) {
  const s = cleanText_(value);
  if (!s) return false;

  // Daily route addresses begin with a street number. This avoids treating
  // route metadata such as "pickups", "CX143", "Planned..." as addresses.
  return /^\d+[A-Z0-9-]*\s+.+/i.test(s);
}

function addComplaint(payload) {
  PREPARE_DATABASE();

  payload = payload || {};
  const address = cleanText_(payload.address);
  const details = cleanText_(payload.details);

  if (!address) throw new Error('La dirección es obligatoria.');
  if (!details) throw new Error('Escribe el detalle del complaint.');

  const normalized = normalizeAddress_(address);
  if (!normalized) throw new Error('La dirección no es válida.');

  const ss = getSS_();
  const sh = ss.getSheetByName(CONFIG.COMPLAINTS_SHEET);
  const now = new Date();

  // Keep one active database record per normalized address.
  if (sh.getLastRow() >= 2) {
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getDisplayValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][5]).toUpperCase() === 'FALSE') continue;
      const existingNormalized = rows[i][2] || normalizeAddress_(rows[i][1]);
      if (existingNormalized !== normalized) continue;

      const rowNumber = i + 2;
      sh.getRange(rowNumber, 2, 1, 5).setValues([[
        address,
        normalized,
        details,
        now,
        true
      ]]);
      sh.getRange(rowNumber, 5).setNumberFormat('MM/dd/yyyy h:mm AM/PM');

      return {
        ok: true,
        updated: true,
        complaint: {
          id: rows[i][0],
          address: address,
          details: details,
          date: Utilities.formatDate(now, Session.getScriptTimeZone(), 'MM/dd/yyyy h:mm a')
        }
      };
    }
  }

  const id = Utilities.getUuid();
  sh.appendRow([id, address, normalized, details, now, true]);
  const row = sh.getLastRow();
  sh.getRange(row, 5).setNumberFormat('MM/dd/yyyy h:mm AM/PM');

  return {
    ok: true,
    updated: false,
    complaint: {
      id: id,
      address: address,
      details: details,
      date: Utilities.formatDate(now, Session.getScriptTimeZone(), 'MM/dd/yyyy h:mm a')
    }
  };
}

function normalizeAddress_(value) {
  let s = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const replacements = [
    [/\bSTREET\b/g, 'ST'],
    [/\bAVENUE\b/g, 'AVE'],
    [/\bBOULEVARD\b/g, 'BLVD'],
    [/\bROAD\b/g, 'RD'],
    [/\bDRIVE\b/g, 'DR'],
    [/\bLANE\b/g, 'LN'],
    [/\bCOURT\b/g, 'CT'],
    [/\bCIRCLE\b/g, 'CIR'],
    [/\bPARKWAY\b/g, 'PKWY'],
    [/\bHIGHWAY\b/g, 'HWY'],
    [/\bPLACE\b/g, 'PL'],
    [/\bTERRACE\b/g, 'TER'],
    [/\bAPARTMENT\b/g, 'APT'],
    [/\bSUITE\b/g, 'STE'],
    [/\bNORTH\b/g, 'N'],
    [/\bSOUTH\b/g, 'S'],
    [/\bEAST\b/g, 'E'],
    [/\bWEST\b/g, 'W']
  ];

  replacements.forEach(([pattern, replacement]) => {
    s = s.replace(pattern, replacement);
  });

  return s.replace(/\s+/g, ' ').trim();
}

function cleanText_(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function UPDATE_DRIVER() {
  const ss = getSS_();
  const shDriver = ss.getSheetByName(CONFIG.DRIVER_SHEET);

  if (!shDriver) {
    SpreadsheetApp.getUi().alert('❌ No existe la hoja Driver.');
    return;
  }

  let shManaged = ss.getSheetByName(CONFIG.MANAGED_SHEET);
  if (!shManaged) {
    shManaged = ss.insertSheet(CONFIG.MANAGED_SHEET);
    shManaged.hideSheet();
  }

  const lastRow = shDriver.getLastRow();
  let drivers = [];

  if (lastRow >= 2) {
    drivers = shDriver
      .getRange(2, 1, lastRow - 1, 1)
      .getDisplayValues()
      .flat()
      .map(v => String(v).trim())
      .filter(Boolean);
  }

  drivers = [...new Set(drivers)];

  const invalidos = [];
  const driversValidos = [];

  drivers.forEach(nombre => {
    if (/[\\/\?\*\[\]\:]/.test(nombre) || nombre.length > 100) {
      invalidos.push(nombre);
      return;
    }

    if ([CONFIG.DRIVER_SHEET, CONFIG.MANAGED_SHEET, CONFIG.COMPLAINTS_SHEET].includes(nombre)) {
      invalidos.push(nombre);
      return;
    }

    driversValidos.push(nombre);
  });

  const managedLastRow = shManaged.getLastRow();
  let managedDrivers = [];

  if (managedLastRow >= 1) {
    managedDrivers = shManaged
      .getRange(1, 1, managedLastRow, 1)
      .getDisplayValues()
      .flat()
      .map(v => String(v).trim())
      .filter(Boolean);
  }

  const creados = [];
  const eliminados = [];

  driversValidos.forEach(driver => {
    if (!ss.getSheetByName(driver)) {
      ss.insertSheet(driver);
      creados.push(driver);
    }
  });

  managedDrivers.forEach(driver => {
    if (!driversValidos.includes(driver)) {
      const hoja = ss.getSheetByName(driver);
      if (hoja) {
        ss.deleteSheet(hoja);
        eliminados.push(driver);
      }
    }
  });

  shManaged.clearContents();
  if (driversValidos.length) {
    shManaged
      .getRange(1, 1, driversValidos.length, 1)
      .setValues(driversValidos.map(driver => [driver]));
  }
  shManaged.hideSheet();

  let mensaje = '✅ DRIVERS ACTUALIZADOS\n\n';
  mensaje += `Drivers activos: ${driversValidos.length}\n`;
  mensaje += `Hojas creadas: ${creados.length}\n`;
  mensaje += `Hojas eliminadas: ${eliminados.length}`;

  if (creados.length) mensaje += `\n\n🟢 Creadas:\n${creados.join('\n')}`;
  if (eliminados.length) mensaje += `\n\n🔴 Eliminadas:\n${eliminados.join('\n')}`;
  if (invalidos.length) mensaje += `\n\n⚠️ Nombres no válidos:\n${invalidos.join('\n')}`;

  SpreadsheetApp.getUi().alert(mensaje);
}