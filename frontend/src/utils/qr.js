// Zero-dependency standards-compliant QR Code generator (Version 1-10, Byte Mode, EC M)
// Generates module matrix and SVG path for TOTP URI.

const QR_ALIGNMENT = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
]

// [total_codewords, ec_codewords_per_block, num_blocks_g1, data_per_block_g1, num_blocks_g2, data_per_block_g2]
const QR_SPECS_M = {
  1: [26, 10, 1, 16, 0, 0],
  2: [44, 16, 1, 28, 0, 0],
  3: [70, 26, 1, 44, 0, 0],
  4: [100, 18, 2, 32, 0, 0],
  5: [134, 24, 2, 43, 0, 0],
  6: [172, 16, 4, 27, 0, 0],
  7: [196, 18, 4, 31, 0, 0],
  8: [242, 22, 2, 38, 2, 39],
  9: [292, 22, 3, 36, 2, 37],
  10: [346, 26, 4, 43, 1, 44],
}

// GF(256) tables with primitive polynomial 0x11d
const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
let val = 1
for (let i = 0; i < 255; i++) {
  EXP[i] = val
  EXP[i + 255] = val
  LOG[val] = i
  val = (val << 1) ^ (val >= 128 ? 0x11d : 0)
}

function gmul(a, b) {
  if (a === 0 || b === 0) return 0
  return EXP[LOG[a] + LOG[b]]
}

function rsPoly(degree) {
  let poly = [1]
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1)
    const root = EXP[i]
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gmul(poly[j], root)
      next[j + 1] ^= poly[j]
    }
    poly = next
  }
  return poly
}

function rsCompute(data, ecLen) {
  const gen = rsPoly(ecLen)
  const rem = new Uint8Array(ecLen)
  for (let i = 0; i < data.length; i++) {
    const coef = data[i] ^ rem[0]
    for (let j = 0; j < ecLen - 1; j++) {
      rem[j] = rem[j + 1] ^ gmul(gen[ecLen - 1 - j], coef)
    }
    rem[ecLen - 1] = gmul(gen[0], coef)
  }
  return rem
}

export function generateQrMatrix(text) {
  const utf8 = new TextEncoder().encode(text)
  const textLen = utf8.length

  let version = 1
  let spec = null
  for (let v = 1; v <= 10; v++) {
    const s = QR_SPECS_M[v]
    const totalDataCapacity = s[2] * s[3] + s[4] * s[5]
    const overheadBytes = v < 10 ? 2 : 3
    if (totalDataCapacity >= textLen + overheadBytes) {
      version = v
      spec = s
      break
    }
  }

  if (!spec) {
    throw new Error('URI terlalu panjang untuk QR generator bawaan.')
  }

  const totalDataBytes = spec[2] * spec[3] + spec[4] * spec[5]

  const bits = []
  function pushBits(v, len) {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((v >> i) & 1)
    }
  }

  // Byte mode: 0100
  pushBits(0b0100, 4)
  // Length
  pushBits(textLen, version < 10 ? 8 : 16)
  // Data
  for (const b of utf8) {
    pushBits(b, 8)
  }
  // Terminator
  const termLen = Math.min(4, totalDataBytes * 8 - bits.length)
  pushBits(0, termLen)
  // Byte alignment
  while (bits.length % 8 !== 0) {
    bits.push(0)
  }
  // Pad bytes
  const pad = [0xec, 0x11]
  let padIdx = 0
  while (bits.length < totalDataBytes * 8) {
    pushBits(pad[padIdx % 2], 8)
    padIdx++
  }

  const dataBytes = new Uint8Array(totalDataBytes)
  for (let i = 0; i < totalDataBytes; i++) {
    let b = 0
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bits[i * 8 + j]
    }
    dataBytes[i] = b
  }

  const ecLen = spec[1]
  const numBlocksG1 = spec[2]
  const dataLenG1 = spec[3]
  const numBlocksG2 = spec[4]
  const dataLenG2 = spec[5]
  const totalBlocks = numBlocksG1 + numBlocksG2

  const dataBlocks = []
  const ecBlocks = []
  let offset = 0

  for (let b = 0; b < numBlocksG1; b++) {
    const block = dataBytes.slice(offset, offset + dataLenG1)
    dataBlocks.push(block)
    ecBlocks.push(rsCompute(block, ecLen))
    offset += dataLenG1
  }
  for (let b = 0; b < numBlocksG2; b++) {
    const block = dataBytes.slice(offset, offset + dataLenG2)
    dataBlocks.push(block)
    ecBlocks.push(rsCompute(block, ecLen))
    offset += dataLenG2
  }

  const interleaved = []
  const maxDataLen = Math.max(dataLenG1, dataLenG2)
  for (let i = 0; i < maxDataLen; i++) {
    for (let b = 0; b < totalBlocks; b++) {
      if (i < dataBlocks[b].length) {
        interleaved.push(dataBlocks[b][i])
      }
    }
  }
  for (let i = 0; i < ecLen; i++) {
    for (let b = 0; b < totalBlocks; b++) {
      interleaved.push(ecBlocks[b][i])
    }
  }

  const size = version * 4 + 17
  const matrix = Array.from({ length: size }, () => new Int8Array(size).fill(-1))

  // Place Finder
  function placeFinder(startX, startY) {
    for (let y = -1; y <= 7; y++) {
      for (let x = -1; x <= 7; x++) {
        const mx = startX + x
        const my = startY + y
        if (mx < 0 || mx >= size || my < 0 || my >= size) continue
        if (
          (x >= 0 && x <= 6 && (y === 0 || y === 6)) ||
          (y >= 0 && y <= 6 && (x === 0 || x === 6)) ||
          (x >= 2 && x <= 4 && y >= 2 && y <= 4)
        ) {
          matrix[my][mx] = 1
        } else {
          matrix[my][mx] = 0
        }
      }
    }
  }

  placeFinder(0, 0)
  placeFinder(size - 7, 0)
  placeFinder(0, size - 7)

  // Timing
  for (let i = 8; i < size - 8; i++) {
    if (matrix[6][i] === -1) matrix[6][i] = i % 2 === 0 ? 1 : 0
    if (matrix[i][6] === -1) matrix[i][6] = i % 2 === 0 ? 1 : 0
  }

  // Alignment
  const alignPos = QR_ALIGNMENT[version] || []
  for (const r of alignPos) {
    for (const c of alignPos) {
      if (matrix[r][c] !== -1) continue
      for (let y = -2; y <= 2; y++) {
        for (let x = -2; x <= 2; x++) {
          if (Math.abs(x) === 2 || Math.abs(y) === 2 || (x === 0 && y === 0)) {
            matrix[r + y][c + x] = 1
          } else {
            matrix[r + y][c + x] = 0
          }
        }
      }
    }
  }

  // Dark module
  matrix[4 * version + 9][8] = 1

  // Format info mask
  for (let i = 0; i < 9; i++) {
    if (matrix[8][i] === -1) matrix[8][i] = 0
    if (matrix[i][8] === -1) matrix[i][8] = 0
  }
  for (let i = size - 8; i < size; i++) {
    if (matrix[8][i] === -1) matrix[8][i] = 0
    if (matrix[i][8] === -1) matrix[i][8] = 0
  }

  // Place data bits with Mask 0
  let bitIdx = 0
  const totalBits = interleaved.length * 8
  let dir = -1
  let x = size - 1

  while (x > 0) {
    if (x === 6) x--
    for (let i = 0; i < size; i++) {
      const row = dir === -1 ? size - 1 - i : i
      for (let c = 0; c < 2; c++) {
        const col = x - c
        if (matrix[row][col] === -1) {
          let bit = 0
          if (bitIdx < totalBits) {
            const byte = interleaved[Math.floor(bitIdx / 8)]
            bit = (byte >> (7 - (bitIdx % 8))) & 1
            bitIdx++
          }
          const masked = bit ^ (((row + col) % 2 === 0) ? 1 : 0)
          matrix[row][col] = masked
        }
      }
    }
    x -= 2
    dir = -dir
  }

  // Format string for EC M + mask 0: 101010000010010
  const formatStr = 0b101010000010010
  for (let i = 0; i < 15; i++) {
    const bit = (formatStr >> (14 - i)) & 1
    if (i < 6) matrix[8][i] = bit
    else if (i === 6) matrix[8][7] = bit
    else if (i === 7) matrix[8][8] = bit
    else if (i === 8) matrix[7][8] = bit
    else matrix[14 - i][8] = bit

    if (i < 8) matrix[size - 1 - i][8] = bit
    else matrix[8][size - 15 + i] = bit
  }

  return { size, matrix }
}
