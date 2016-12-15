
import _ from 'lodash'
import fs from 'fs-extra'
import libxmljs from 'libxmljs'

function safeParseInt(string) {
  const number = parseInt(string)
  if (Number.isNaN(number) || number.toString() !== string) {
    throw new Error(`Parse int failed: ${string}`)
  }
  return number
}

const ROUTE = {}
const SPOTS = {}
const SPOTS_NAME = {}

function extract() {
  const xmlData = fs.readFileSync("swf.xml")
  const xml = libxmljs.parseXml(xmlData)

  const map0 = xml.get(`//item[@name='map']`)
  const map1Id = map0.attr('characterId').value()
  const map1 = xml.get(`//item[@spriteId='${map1Id}']`)
  const lineRefs = map1.find('subTags/item')

  for (const lineRef of lineRefs) {
    try {
      const nameAttr = lineRef.attr('name')
      if (nameAttr == null) continue
      const name = nameAttr.value()
      const [, id] = name.match(/^line(\d+)$/) || []
      if (id == null) continue

      // end coord
      const matrix = lineRef.get('matrix')
      const endX = matrix.attr('translateX').value()
      const endY = matrix.attr('translateY').value()
      const end = [safeParseInt(endX), safeParseInt(endY)]
      // start coord
      const spriteId = lineRef.attr('characterId').value()   // sprite lineX
      const sprite = xml.get(`//item[@spriteId='${spriteId}']`)
      const shapeRef = sprite.get('subTags/item[@characterId]')  // shape
      let dx = 0  // delta = (start - end) x, y
      let dy = 0
      if (shapeRef != null) {
        const refMatrix = shapeRef.get('matrix')
        dx = safeParseInt(refMatrix.attr('translateX').value())
        dy = safeParseInt(refMatrix.attr('translateY').value())

        const shapeId = shapeRef.attr('characterId').value()
        const shape = xml.get(`//item[@shapeId='${shapeId}']`)
        const shapeBounds = shape.get('shapeBounds')
        const Xmax = safeParseInt(shapeBounds.attr('Xmax').value())
        const Xmin = safeParseInt(shapeBounds.attr('Xmin').value())
        const Ymax = safeParseInt(shapeBounds.attr('Ymax').value())
        const Ymin = safeParseInt(shapeBounds.attr('Ymin').value())
        dx = (dx + (Xmax + Xmin) / 2) * 2
        dy = (dy + (Ymax + Ymin) / 2) * 2
      }
      const start = (dx | dy) === 0 ? null : [end[0] + dx, end[1] + dy]

      ROUTE[id] = {start, end}
      SPOTS[end.join()] = {coord: end, start: start == null}
    }
    catch (e) {
      console.error(line.toString())
      console.error(e.stack)
    }
  }
}

function fit_route() {
  const TOLERANCE = 0.5
  _.forOwn(ROUTE, ({start, end}, id) => {
    if (start == null) return
    const distance = {}
    let mid = null   // id of minimum distance
    _.forOwn(SPOTS, ({coord}, id) => {
      distance[id] = Math.sqrt(Math.pow((coord[0] - start[0]), 2) + Math.pow((coord[1] - start[1]), 2))
      if (mid == null || distance[id] < distance[mid])
        mid = id
    })
    _.forOwn(distance, (dst, did) => {
      if (did === mid) return
      if (distance[mid] > dst * TOLERANCE) {
        console.warn(`Route${id}: Fitting run over tolerance. M=${mid},${distance[mid]}, D=${did},${dst}`)
      }
    })
    ROUTE[id].start = SPOTS[mid].coord
  })
}

function check_name() {
  if (!fs.existsSync('spots.json')) {
    fs.writeJSONSync('spots.json', {})
  }
  const named = JSON.parse(fs.readFileSync('spots.json'))
  const unamed = {}
  _.forOwn(SPOTS, (spot, id) => {
    if (named[id] != null) {
      delete SPOTS[id]
      SPOTS[named[id]] = spot
      SPOTS_NAME[id] = named[id]
    } else {
      unamed[id] = spot.coord.join('_')
      SPOTS_NAME[id] = unamed[id]
    }
  })
  fs.writeJSONSync('spots_unamed.json', unamed)
  if (Object.keys(unamed).length > 0) {
    console.warn([
      `Unamed spot found!`,
      `Please set their name in "spots.json"`,
    ].join('\n'))
  }
}

function draw() {
  const SCALE = 20
  const elements = []

  _.forOwn(ROUTE, ({start, end}, id) => {
    if (start == null) return
    const s = start.map(n => n / SCALE)
    const e =   end.map(n => n / SCALE)
    const m = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2]
    elements.push(`<line x1="${s[0]}" y1="${s[1]}" x2="${e[0]}" y2="${e[1]}" stroke="black" stroke-width="2" marker-end="url(#arrow)" />`)
    elements.push(`<text x="${m[0]}" y="${m[1]}" font-family="sans-serif" font-size="16">${id}</text>`)
  })
  _.forOwn(SPOTS, ({coord, start}, id) => {
    const color = start ? "#dd0" : "#d00"
    const c = coord.map(n => n / SCALE)
    const fs = id.length > 1 ? 12 : 16
    elements.push(`<circle cx="${c[0]}" cy="${c[1]}" r="4" style="fill:${color};"/>`)
    elements.push(`<text x="${c[0]}" y="${c[1]+fs}" style="fill:${color}" font-family="sans-serif" font-size="${fs}">${id}</text>`)
  })

  fs.writeFileSync('draw.svg',
`<?xml version="1.0"?>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg"
    width="800" height="480">
  <defs>
  <marker id="arrow" refX="7" refY="2" markerWidth="6" markerHeight="9" orient="auto" markerUnits="strokeWidth">
    <path d="M0,0 L0,4 L7,2 z" fill="#000" />
  </marker>
  </defs>
  ${elements.join('\n')}
</svg>
` )
}

function generate() {
  const route = {}
  _.forOwn(ROUTE, ({start, end}, id) => {
    route[id] = [
      start ? SPOTS_NAME[start.join()] : null,
      end   ? SPOTS_NAME[end.join()]   : null,
    ]
  })
  const spots = {}
  _.forOwn(SPOTS, ({coord, start}, id) => {
    let type = start ? 'start' : ''
    spots[id] = [coord[0], coord[1], type]
  })
  fs.writeJSONSync('poi.json', {route, spots})
}

function clean() {
  const FILE = ['kcmap.js', 'spots_unamed.json', 'draw.svg', 'poi.json']
  for (const file of FILE) {
    try {
      fs.unlinkSync(file)
    }
    catch (err) {
      if (err.code === 'ENOENT')
        continue
      throw err
    }
  }
}


(() => {
  const PROCEDURE = {
    ''        : [extract, check_name, fit_route, draw],
    'generate': [extract, check_name, fit_route, generate],
    'clean'   : [clean],
  }
  const cmd = process.argv[2] || ''
  for (const proceduce of PROCEDURE[cmd]) {
    proceduce()
  }
})()
