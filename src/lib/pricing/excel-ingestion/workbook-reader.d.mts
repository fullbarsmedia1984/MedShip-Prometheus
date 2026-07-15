export type GridCell = {
  text: string
  isDate: boolean
  dateIso: string | null
  isFormula: boolean
  address: string
}

export type SheetGrid = {
  name: string
  rows: Array<Array<GridCell | null> | null>
}

export function readWorkbookGrids(buffer: Buffer | ArrayBuffer): Promise<SheetGrid[]>
