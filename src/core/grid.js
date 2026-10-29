// Board grid: cell names like "H9" <-> board coordinates in mm.
// Origin is the bottom-left corner of the board, x to the right, y up.
// Column letters A.. run left to right, rows 1.. run bottom to top; a cell's point is its centre.

const A = 'A'.charCodeAt(0);

export function parseCell(cell) {
  const m = /^([A-Z])(\d{1,2})$/.exec(cell);
  if (!m) throw new Error(`invalid cell "${cell}"`);
  return { col: m[1].charCodeAt(0) - A, row: Number(m[2]) - 1 };
}

export function cellToMm(cell, pitch) {
  const { col, row } = parseCell(cell);
  return { x: (col + 0.5) * pitch, y: (row + 0.5) * pitch };
}

export function colName(col) {
  return String.fromCharCode(A + col);
}

export function boardSizeMm(board) {
  return { w: board.cols * board.pitch_mm, h: board.rows * board.pitch_mm };
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
