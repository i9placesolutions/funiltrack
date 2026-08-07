/**
 * Gera os ícones PWA do FunilTrack como PNGs válidos usando apenas o
 * zlib nativo do Node (sem dependências nativas como sharp/canvas).
 *
 * Desenho: fundo no tom escuro do design token (--color-bg dark) com um
 * gráfico de barras estilizado no teal primário (motivo: funil/tracking).
 *
 * Saída em public/icons/:
 *  - icon-192.png         (any, 192x192)
 *  - icon-512.png         (any, 512x512)
 *  - icon-maskable-512.png (maskable, conteúdo dentro da safe zone de 80%)
 *  - apple-touch-icon.png  (180x180, fundo sólido — iOS aplica as bordas)
 *
 * Uso: pnpm icons
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/* Cores alinhadas à logo FunilTrack (navy → cyan) */
const BG = [0, 0, 0] // fundo da identidade
const PRIMARY = [0, 191, 255] // cyan
const ACCENT = [0, 114, 255] // azul elétrico

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = join(__dirname, '..', 'public', 'icons')

/* ------------------------------------------------------------------ */
/* Encoder PNG mínimo (RGB, sem alpha)                                 */
/* ------------------------------------------------------------------ */

// Tabela CRC-32 (polinômio do PNG).
const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n += 1) {
  let c = n
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  CRC_TABLE[n] = c >>> 0
}

function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

/** pixels: Buffer RGB (3 bytes por pixel), sem canais de filtro. */
function encodePng(size, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.writeUInt8(8, 8) // profundidade de bit
  ihdr.writeUInt8(2, 9) // color type: RGB truecolor
  ihdr.writeUInt8(0, 10) // compressão
  ihdr.writeUInt8(0, 11) // filtro
  ihdr.writeUInt8(0, 12) // sem entrelaçamento

  // Cada scanline recebe o byte de filtro 0 (None) como prefixo.
  const stride = size * 3
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/* ------------------------------------------------------------------ */
/* Rasterização do logo (gráfico de barras)                            */
/* ------------------------------------------------------------------ */

/**
 * Desenha o ícone.
 * @param {number} size dimensão em pixels
 * @param {boolean} maskable se true, o glifo fica restrito à safe zone de 80%
 */
function renderIcon(size, maskable) {
  const pixels = Buffer.alloc(size * size * 3)

  // Em ícones maskable o glifo é escalado para o centro (safe zone ~80%).
  const scale = maskable ? 0.8 : 1
  const offset = maskable ? 0.1 : 0
  // Converte coordenadas normalizadas (0–1) para pixels do canvas.
  const nx = (v) => (offset + v * scale) * size
  const ny = (v) => (offset + v * scale) * size

  // Três barras ascendentes, alinhadas por baixo.
  const baseline = 0.82
  const barWidth = 0.16
  const gap = 0.07
  const totalWidth = 3 * barWidth + 2 * gap
  const startX = (1 - totalWidth) / 2
  const bars = [
    { x: startX, height: 0.24, color: PRIMARY },
    { x: startX + barWidth + gap, height: 0.4, color: PRIMARY },
    { x: startX + 2 * (barWidth + gap), height: 0.56, color: ACCENT },
  ]

  const radius = (barWidth / 3) * size * scale

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let color = BG

      for (const bar of bars) {
        const x0 = nx(bar.x)
        const x1 = nx(bar.x + barWidth)
        const yTop = ny(baseline - bar.height)
        const yBottom = ny(baseline)
        if (x < x0 || x >= x1 || y < yTop || y >= yBottom) continue

        // Cantos superiores arredondados.
        if (y < yTop + radius) {
          const dy = yTop + radius - y
          const dx = radius - Math.sqrt(Math.max(radius * radius - dy * dy, 0))
          if (x < x0 + dx || x >= x1 - dx) continue
        }
        color = bar.color
      }

      const idx = (y * size + x) * 3
      pixels[idx] = color[0]
      pixels[idx + 1] = color[1]
      pixels[idx + 2] = color[2]
    }
  }
  return pixels
}

/* ------------------------------------------------------------------ */

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
]

mkdirSync(OUT_DIR, { recursive: true })
for (const target of targets) {
  const png = encodePng(target.size, renderIcon(target.size, target.maskable))
  const path = join(OUT_DIR, target.file)
  writeFileSync(path, png)
  console.log(`✓ ${path} (${target.size}x${target.size}, ${png.length} bytes)`)
}
