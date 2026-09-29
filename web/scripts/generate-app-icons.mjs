import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import sharp from 'sharp'

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(web, '..')
const source = path.join(web, 'public/icons/icon-512.svg')
const jobs = [
  ['icon-192.svg', 192, 'icon-192.png'],
  ['icon-512.svg', 512, 'icon-512.png'],
  ['icon-maskable-192.svg', 192, 'icon-maskable-192.png'],
  ['icon-maskable-512.svg', 512, 'icon-maskable-512.png'],
  ['icon-512.svg', 180, 'apple-touch-icon.png'],
]

await Promise.all(jobs.map(([input, size, output]) =>
  sharp(path.join(web, 'public/icons', input))
    .resize(size, size)
    .png()
    .toFile(path.join(web, 'public/icons', output)),
))

await sharp(source).resize(1024, 1024).png()
  .toFile(path.join(root, 'apps/mobile/assets/icon.png'))

const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = await Promise.all(sizes.map((size) =>
  sharp(source).resize(size, size).png().toBuffer()))
const header = Buffer.alloc(6 + images.length * 16)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)
let offset = header.length
for (const [index, image] of images.entries()) {
  const size = sizes[index]
  const entry = 6 + index * 16
  header[entry] = size % 256
  header[entry + 1] = size % 256
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(image.length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += image.length
}
await writeFile(path.join(root, 'apps/desktop/assets/icon.ico'), Buffer.concat([header, ...images]))
