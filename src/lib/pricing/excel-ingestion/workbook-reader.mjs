/**
 * exceljs adapter: converts an .xlsx buffer into the simple grid model the
 * pure native engine consumes. Kept separate so engine logic stays free of
 * the exceljs dependency and both modules run under node:test.
 */

import ExcelJS from 'exceljs'

function cellToGridCell(cell) {
  const value = cell.value
  const isFormula = Boolean(value && typeof value === 'object' && 'formula' in value)
  const effective = isFormula ? value.result : value

  let text = ''
  let isDate = false
  let dateIso = null

  if (effective instanceof Date) {
    isDate = true
    dateIso = effective.toISOString()
    text = dateIso.slice(0, 10)
  } else if (effective && typeof effective === 'object') {
    if ('richText' in effective && Array.isArray(effective.richText)) {
      text = effective.richText.map((part) => String(part.text ?? '')).join('')
    } else if ('text' in effective) {
      text = String(effective.text ?? '')
    } else if ('error' in effective) {
      text = ''
    } else {
      text = String(effective)
    }
  } else if (effective !== null && effective !== undefined) {
    text = String(effective)
  }

  return {
    text: text.trim(),
    isDate,
    dateIso,
    isFormula,
    address: cell.address,
  }
}

/**
 * @param {Buffer|ArrayBuffer} buffer xlsx file contents
 * @returns {Promise<Array<{name: string, rows: Array}>>} 1-indexed grids
 */
export async function readWorkbookGrids(buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const grids = []
  workbook.eachSheet((worksheet) => {
    const rows = [null]
    for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex += 1) {
      const row = worksheet.getRow(rowIndex)
      const cells = [null]
      for (let colIndex = 1; colIndex <= worksheet.columnCount; colIndex += 1) {
        const cell = row.getCell(colIndex)
        cells[colIndex] = cell.value === null || cell.value === undefined ? null : cellToGridCell(cell)
      }
      rows[rowIndex] = cells
    }
    grids.push({ name: worksheet.name, rows })
  })

  return grids
}
