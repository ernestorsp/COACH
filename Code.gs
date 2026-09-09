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

function getHomeData() {
  PREPARE_DATABASE();

  const ss = getSS_();
  const sh = ss.getSheetByName(CONFIG.COMPLAINTS_SHEET);
  const lastRow = sh.getLastRow();

  let total = 0;
  let recent = [];

  if (lastRow >= 2) {
    const values = sh.getRange(2, 1, lastRow - 1, 6).getDisplayValues();
    const activeRows = values.filter(r => String(r[5]).toUpperCase() !== 'FALSE');
    total = activeRows.length;

    recent = activeRows
      .slice(-8)
      .reverse()
      .map(r => ({
        id: r[0],
        address: r[1],
        details: r[3],
        date: r[4]
      }));
  }

  return {
    totalComplaints: total,
    alerts: [],
    recent: recent,
    routeMatchingReady: false
  };
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

  const id = Utilities.getUuid();
  const now = new Date();

  sh.appendRow([
    id,
    address,
    normalized,
    details,
    now,
    true
  ]);

  const row = sh.getLastRow();
  sh.getRange(row, 5).setNumberFormat('MM/dd/yyyy h:mm AM/PM');

  return {
    ok: true,
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