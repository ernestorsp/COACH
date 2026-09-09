const CONFIG = {
  SPREADSHEET_ID: '11j1cRxIDCZ_mrbfUuZFsVSpg_CisY8R5YmjU2_DT0aM',
  DRIVER_SHEET: 'Driver',
  MANAGED_SHEET: '_DRIVER_MANAGED',
  COMPLAINTS_SHEET: 'Complaints',
  DONE_SHEET: '_DONE_STOPS',
  TIMEZONE: 'America/New_York'
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
    .addItem('🕛 ENABLE DAILY CLEANUP', 'SETUP_DAILY_CLEANUP')
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

  prepareDoneSheet_(ss);
  return true;
}

function prepareDoneSheet_(ss) {
  let sh = ss.getSheetByName(CONFIG.DONE_SHEET);
  if (!sh) sh = ss.insertSheet(CONFIG.DONE_SHEET);

  const headers = ['DATE_KEY', 'DRIVER', 'STOP', 'NORMALIZED_ADDRESS', 'ADDRESS', 'DONE_AT'];
  const current = sh.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  if (current.join('|') !== headers.join('|')) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  sh.setFrozenRows(1);
  sh.hideSheet();
  return sh;
}

function getHomeData() {
  PREPARE_DATABASE();
  const ss = getSS_();
  const complaints = getActiveComplaints_(ss);
  const complaintMap = new Map();
  complaints.forEach(c => complaintMap.set(c.normalizedAddress, c));

  const todayKey = getTodayKey_();
  const doneKeys = getDoneKeys_(ss, todayKey);
  const drivers = getDriverNames_(ss);
  const alerts = [];

  drivers.forEach(driver => {
    const sh = ss.getSheetByName(driver);
    if (!sh || sh.getLastRow() < 1) return;

    parseDriverRoute_(sh).forEach(route => {
      const normalizedRoute = normalizeAddress_(route.address);
      const complaint = complaintMap.get(normalizedRoute);
      if (!complaint) return;

      const doneKey = buildDoneKey_(driver, route.stop, normalizedRoute);
      if (doneKeys.has(doneKey)) return;

      alerts.push({
        driver,
        stop: route.stop,
        address: route.address,
        normalizedAddress: normalizedRoute,
        details: complaint.details,
        complaintAddress: complaint.address,
        complaintId: complaint.id
      });
    });
  });

  alerts.sort((a, b) => {
    const d = a.driver.localeCompare(b.driver);
    return d !== 0 ? d : Number(a.stop) - Number(b.stop);
  });

  return {
    totalComplaints: complaints.length,
    alerts,
    recent: complaints.slice(-8).reverse().map(c => ({
      id: c.id,
      address: c.address,
      details: c.details,
      date: c.date
    })),
    drivers,
    driversWithAlerts: [...new Set(alerts.map(a => a.driver))],
    routeMatchingReady: true
  };
}

function markStopDone(payload) {
  PREPARE_DATABASE();
  payload = payload || {};

  const driver = cleanText_(payload.driver);
  const stop = cleanText_(payload.stop);
  const address = cleanText_(payload.address);
  const normalized = normalizeAddress_(payload.normalizedAddress || address);

  if (!driver) throw new Error('Falta el driver.');
  if (!stop) throw new Error('Falta el número de parada.');
  if (!normalized) throw new Error('Falta la dirección.');

  const ss = getSS_();
  const sh = prepareDoneSheet_(ss);
  const todayKey = getTodayKey_();
  const key = buildDoneKey_(driver, stop, normalized);
  const existing = getDoneKeys_(ss, todayKey);

  if (!existing.has(key)) {
    sh.appendRow([todayKey, driver, Number(stop), normalized, address, new Date()]);
    sh.getRange(sh.getLastRow(), 6).setNumberFormat('MM/dd/yyyy h:mm AM/PM');
  }

  return { ok: true };
}

function getDoneKeys_(ss, dateKey) {
  const sh = prepareDoneSheet_(ss);
  const lastRow = sh.getLastRow();
  const keys = new Set();
  if (lastRow < 2) return keys;

  sh.getRange(2, 1, lastRow - 1, 4).getDisplayValues().forEach(r => {
    if (cleanText_(r[0]) !== dateKey) return;
    keys.add(buildDoneKey_(r[1], r[2], r[3]));
  });
  return keys;
}

function buildDoneKey_(driver, stop, normalizedAddress) {
  return [cleanText_(driver).toUpperCase(), cleanText_(stop), normalizeAddress_(normalizedAddress)].join('|');
}

function getTodayKey_() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function getComplaints() {
  PREPARE_DATABASE();
  return getActiveComplaints_(getSS_()).reverse();
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

function parseDriverRoute_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const lines = sheet.getRange(1, 1, lastRow, 1)
    .getDisplayValues()
    .flat()
    .map(cleanText_);

  const stops = [];
  for (let i = 0; i < lines.length; i++) {
    const current = lines[i];
    if (!/^\d+$/.test(current)) continue;

    let j = i + 1;
    while (j < lines.length && !lines[j]) j++;
    if (j >= lines.length) continue;

    const address = lines[j];
    if (!looksLikeStreetAddress_(address)) continue;
    stops.push({ stop: Number(current), address });
  }
  return stops;
}

function looksLikeStreetAddress_(value) {
  const s = cleanText_(value);
  return !!s && /^\d+[A-Z0-9-]*\s+.+/i.test(s);
}

function addComplaint(payload) {
  PREPARE_DATABASE();
  payload = payload || {};

  const address = cleanText_(payload.address);
  const details = cleanText_(payload.details);
  const duplicateAction = cleanText_(payload.duplicateAction).toLowerCase();

  if (!address) throw new Error('La dirección es obligatoria.');
  if (!details) throw new Error('Escribe el detalle del complaint.');

  const normalized = normalizeAddress_(address);
  if (!normalized) throw new Error('La dirección no es válida.');

  const ss = getSS_();
  const sh = ss.getSheetByName(CONFIG.COMPLAINTS_SHEET);
  const existing = findComplaintByNormalized_(sh, normalized);

  if (existing && !duplicateAction) {
    return {
      ok: false,
      conflict: true,
      existing: {
        id: existing.id,
        address: existing.address,
        details: existing.details,
        date: existing.date
      },
      incoming: { address, details }
    };
  }

  if (existing) {
    if (duplicateAction === 'cancel') return { ok: false, cancelled: true };

    if (duplicateAction === 'overwrite') {
      sh.deleteRow(existing.rowNumber);
      const created = appendComplaint_(sh, address, normalized, details);
      return { ok: true, action: 'overwrite', complaint: created };
    }

    if (duplicateAction === 'add') {
      const mergedDetails = [existing.details, details].filter(Boolean).join('\n• ');
      const finalDetails = existing.details ? '• ' + mergedDetails : details;
      const now = new Date();
      sh.getRange(existing.rowNumber, 2, 1, 5).setValues([[
        address,
        normalized,
        finalDetails,
        now,
        true
      ]]);
      sh.getRange(existing.rowNumber, 5).setNumberFormat('MM/dd/yyyy h:mm AM/PM');
      return {
        ok: true,
        action: 'add',
        complaint: {
          id: existing.id,
          address,
          details: finalDetails,
          date: Utilities.formatDate(now, CONFIG.TIMEZONE, 'MM/dd/yyyy h:mm a')
        }
      };
    }

    throw new Error('Acción de duplicado no válida.');
  }

  const created = appendComplaint_(sh, address, normalized, details);
  return { ok: true, action: 'created', complaint: created };
}

function appendComplaint_(sh, address, normalized, details) {
  const id = Utilities.getUuid();
  const now = new Date();
  sh.appendRow([id, address, normalized, details, now, true]);
  const row = sh.getLastRow();
  sh.getRange(row, 5).setNumberFormat('MM/dd/yyyy h:mm AM/PM');

  return {
    id,
    address,
    details,
    date: Utilities.formatDate(now, CONFIG.TIMEZONE, 'MM/dd/yyyy h:mm a')
  };
}

function updateComplaint(payload) {
  PREPARE_DATABASE();
  payload = payload || {};
  const id = cleanText_(payload.id);
  const address = cleanText_(payload.address);
  const details = cleanText_(payload.details);

  if (!id) throw new Error('Falta el ID.');
  if (!address) throw new Error('La dirección es obligatoria.');
  if (!details) throw new Error('Las notas son obligatorias.');

  const normalized = normalizeAddress_(address);
  const sh = getSS_().getSheetByName(CONFIG.COMPLAINTS_SHEET);
  const row = findComplaintRowById_(sh, id);
  if (!row) throw new Error('No encontré esa dirección.');

  const other = findComplaintByNormalized_(sh, normalized, id);
  if (other) throw new Error('Ya existe otra dirección igual en la base de datos.');

  const now = new Date();
  sh.getRange(row, 2, 1, 5).setValues([[address, normalized, details, now, true]]);
  sh.getRange(row, 5).setNumberFormat('MM/dd/yyyy h:mm AM/PM');
  return { ok: true };
}

function deleteComplaint(id) {
  PREPARE_DATABASE();
  id = cleanText_(id);
  if (!id) throw new Error('Falta el ID.');

  const sh = getSS_().getSheetByName(CONFIG.COMPLAINTS_SHEET);
  const row = findComplaintRowById_(sh, id);
  if (!row) throw new Error('No encontré esa dirección.');

  sh.deleteRow(row);
  return { ok: true };
}

function findComplaintRowById_(sh, id) {
  if (sh.getLastRow() < 2) return 0;
  const ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getDisplayValues().flat();
  const index = ids.findIndex(v => cleanText_(v) === id);
  return index < 0 ? 0 : index + 2;
}

function findComplaintByNormalized_(sh, normalized, excludeId) {
  if (sh.getLastRow() < 2) return null;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getDisplayValues();

  for (let i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][5]).toUpperCase() === 'FALSE') continue;
    if (excludeId && cleanText_(rows[i][0]) === excludeId) continue;
    const n = rows[i][2] || normalizeAddress_(rows[i][1]);
    if (n !== normalized) continue;

    return {
      rowNumber: i + 2,
      id: rows[i][0],
      address: rows[i][1],
      details: rows[i][3],
      date: rows[i][4]
    };
  }
  return null;
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
    [/\bSTREET\b/g, 'ST'], [/\bAVENUE\b/g, 'AVE'], [/\bBOULEVARD\b/g, 'BLVD'],
    [/\bROAD\b/g, 'RD'], [/\bDRIVE\b/g, 'DR'], [/\bLANE\b/g, 'LN'],
    [/\bCOURT\b/g, 'CT'], [/\bCIRCLE\b/g, 'CIR'], [/\bPARKWAY\b/g, 'PKWY'],
    [/\bHIGHWAY\b/g, 'HWY'], [/\bPLACE\b/g, 'PL'], [/\bTERRACE\b/g, 'TER'],
    [/\bAPARTMENT\b/g, 'APT'], [/\bSUITE\b/g, 'STE'], [/\bNORTH\b/g, 'N'],
    [/\bSOUTH\b/g, 'S'], [/\bEAST\b/g, 'E'], [/\bWEST\b/g, 'W']
  ];

  replacements.forEach(([pattern, replacement]) => s = s.replace(pattern, replacement));
  return s.replace(/\s+/g, ' ').trim();
}

function cleanText_(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function SETUP_DAILY_CLEANUP() {
  const functionName = 'DAILY_CLEAR_DRIVER_ROUTES';

  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === functionName) ScriptApp.deleteTrigger(trigger);
  });

  ScriptApp.newTrigger(functionName)
    .timeBased()
    .atHour(0)
    .nearMinute(0)
    .everyDays(1)
    .inTimezone(CONFIG.TIMEZONE)
    .create();

  SpreadsheetApp.getUi().alert('✅ Limpieza diaria activada.\n\nLas hojas de los drivers se limpiarán cada día alrededor de las 12:00 AM.');
}

function DAILY_CLEAR_DRIVER_ROUTES() {
  const ss = getSS_();
  const drivers = getDriverNames_(ss);

  drivers.forEach(driver => {
    const sh = ss.getSheetByName(driver);
    if (!sh) return;
    sh.clearContents();
  });

  const doneSh = prepareDoneSheet_(ss);
  if (doneSh.getLastRow() >= 2) {
    doneSh.getRange(2, 1, doneSh.getLastRow() - 1, doneSh.getMaxColumns()).clearContent();
  }

  return { ok: true, driversCleared: drivers.length };
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
    drivers = shDriver.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat().map(v => String(v).trim()).filter(Boolean);
  }
  drivers = [...new Set(drivers)];

  const invalidos = [];
  const driversValidos = [];
  drivers.forEach(nombre => {
    if (/[\\/\?\*\[\]\:]/.test(nombre) || nombre.length > 100 || [CONFIG.DRIVER_SHEET, CONFIG.MANAGED_SHEET, CONFIG.COMPLAINTS_SHEET, CONFIG.DONE_SHEET].includes(nombre)) {
      invalidos.push(nombre);
      return;
    }
    driversValidos.push(nombre);
  });

  const managedLastRow = shManaged.getLastRow();
  let managedDrivers = [];
  if (managedLastRow >= 1) {
    managedDrivers = shManaged.getRange(1, 1, managedLastRow, 1).getDisplayValues().flat().map(v => String(v).trim()).filter(Boolean);
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
  if (driversValidos.length) shManaged.getRange(1, 1, driversValidos.length, 1).setValues(driversValidos.map(driver => [driver]));
  shManaged.hideSheet();

  let mensaje = '✅ DRIVERS ACTUALIZADOS\n\n';
  mensaje += `Drivers activos: ${driversValidos.length}\nHojas creadas: ${creados.length}\nHojas eliminadas: ${eliminados.length}`;
  if (creados.length) mensaje += `\n\n🟢 Creadas:\n${creados.join('\n')}`;
  if (eliminados.length) mensaje += `\n\n🔴 Eliminadas:\n${eliminados.join('\n')}`;
  if (invalidos.length) mensaje += `\n\n⚠️ Nombres no válidos:\n${invalidos.join('\n')}`;
  SpreadsheetApp.getUi().alert(mensaje);
}