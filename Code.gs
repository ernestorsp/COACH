const CONFIG = {
  DRIVER_SHEET: 'Driver',
  MANAGED_SHEET: '_DRIVER_MANAGED'
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🚚 COACH')
    .addItem('🔄 UPDATE DRIVER', 'UPDATE_DRIVER')
    .addToUi();
}

function UPDATE_DRIVER() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
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

    if ([CONFIG.DRIVER_SHEET, CONFIG.MANAGED_SHEET].includes(nombre)) {
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
