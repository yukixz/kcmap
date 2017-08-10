
import _ from 'lodash'
import fs from 'fs-extra'
import libxmljs from 'libxmljs'

function safeParseInt(string) {
  const number = Number(string)
  if (Number.isNaN(number)) {
    throw new Error(`Parse int failed: ${string}`)
  }
  return number
}

const ROUTE = {}
const SPOTS = {}
const DRAWS = []
const SCALE = 20  // scale from flash coord to xml coord. (20fp = 1px)
const FIT_TOLERANCE = 0.7

function extract() {
  const xmlData = fs.readFileSync("swf.xml")
  const xml = libxmljs.parseXml(xmlData)
  // const lineRefs = xml.find(`//item[starts-with(@name, 'line')]`)

  const containers = []

  // First container
  const mapRef = xml.get(`//item[@name='map']`)
  containers.push(mapRef)
  // Set root map to (0,0)
  const mapMatrix = mapRef.get('matrix')
  mapMatrix.attr('translateX').value(0)
  mapMatrix.attr('translateY').value(0)

  while (containers.length > 0) {
    const mapRef = containers.pop()
    const mapId = mapRef.attr('characterId').value()
    const map = xml.get(`//item[@spriteId='${mapId}']`)
    const itemRefs = map.find('subTags/item')

    const mapMatrix = mapRef.get('matrix')
    const mapX  = safeParseInt(mapMatrix.attr('translateX').value())
    const mapY  = safeParseInt(mapMatrix.attr('translateY').value())

    for (const itemRef of itemRefs) {
      try {
        const nameAttr = itemRef.attr('name')
        if (nameAttr == null) continue
        const name = nameAttr.value()
        let m

        m = name.match(/^extra(\d+)$/)
        if (m != null) {
          const itemMatrix = itemRef.get('matrix')
          const itemAX = itemMatrix.attr('translateX')
          const itemAY = itemMatrix.attr('translateY')
          itemAX.value(mapX + safeParseInt(itemAX.value()))
          itemAY.value(mapY + safeParseInt(itemAY.value()))
          containers.push(itemRef)
        }

        m = name.match(/^line(\d+)$/)
        if (m != null) {
          const [, id] = m
          // end coord
          const matrix = itemRef.get('matrix')
          const endX = safeParseInt(matrix.attr('translateX').value())
          const endY = safeParseInt(matrix.attr('translateY').value())
          const end = [mapX + endX, mapY + endY]
          // start coord
          const spriteId = itemRef.attr('characterId').value()   // sprite lineX
          const sprite = xml.get(`//item[@spriteId='${spriteId}']`)
          const shapeRef = sprite.get('subTags/item[@characterId]')  // shape
          let dx = 0  // delta = (start - end) x, y
          let dy = 0
          if (shapeRef != null) {
            const refMatrix = shapeRef.get('matrix')
            const shX = safeParseInt(refMatrix.attr('translateX').value())
            const shY = safeParseInt(refMatrix.attr('translateY').value())

            const shapeId = shapeRef.attr('characterId').value()
            const shape = xml.get(`//item[@shapeId='${shapeId}']`)
            const shapeBounds = shape.get('shapeBounds')
            const Xmax = safeParseInt(shapeBounds.attr('Xmax').value())
            const Xmin = safeParseInt(shapeBounds.attr('Xmin').value())
            const Ymax = safeParseInt(shapeBounds.attr('Ymax').value())
            const Ymin = safeParseInt(shapeBounds.attr('Ymin').value())
            dx = (shX + (Xmax + Xmin) / 2) * 2
            dy = (shY + (Ymax + Ymin) / 2) * 2
          }
          const start = (dx | dy) === 0 ? null : [end[0] + dx, end[1] + dy]

          ROUTE[id] = {start, end}
          SPOTS[end.join()] = {
            coord: end,
            start: start == null,  // is start?
            name : end.join('_'),
            tag  : [],
          }
        }
      }
      catch (e) {
        console.error(e.stack)
      }
    }
  }
}

function fitting() {
  // Fit spots
  const nsmap = {}
  _.forIn(SPOTS, ({name}, id) => {
    if (nsmap[name] == null)
      nsmap[name] = []
    nsmap[name].push(id)
  })
  _.forIn(nsmap, (ids, name) => {
    if (ids.length === 1) return
    const id = ids.find(id => {
      const [x, y] = SPOTS[id].coord
      return x % 10 === 0 && y % 10 === 0
    }) || ids[0]
    const idCoord = SPOTS[id].coord
    console.warn(`Merging spots ${ids.join('/')} to ${id}`)
    for (const oid of ids) {
      if (oid === id) continue
      delete SPOTS[oid]
      _.forIn(ROUTE, (route, id) => {
        const {start, end} = route
        if (start && start.join() === oid)
          route.start = idCoord
        if (end && end.join() === oid)
          route.end = idCoord
      })
    }
  })
  // Fit Route
  _.forIn(ROUTE, ({start}, id) => {
    if (start == null) return
    const distance = {}
    let mid = null, mdst = null   // id of minimum distance
    _.forIn(SPOTS, ({coord}, id) => {
      distance[id] = Math.sqrt(Math.pow((coord[0] - start[0]), 2) + Math.pow((coord[1] - start[1]), 2))
      if (mid == null || distance[id] < distance[mid]) {
        mid = id
        mdst = distance[id]
      }
    })
    _.forIn(distance, (dst, did) => {
      if (did === mid) return
      if (mdst > dst * FIT_TOLERANCE) {
        console.warn(`Fit route over tolerance. Route=${id}, Min=${mid}:${mdst.toFixed(2)}, Cur=${did}:${dst.toFixed(2)}`)
      }
    })
    ROUTE[id].start = SPOTS[mid].coord
  })
}

function addSpotName() {
  if (!fs.existsSync('spots.json')) {
    fs.writeJSONSync('spots.json', {})
  }
  const named = JSON.parse(fs.readFileSync('spots.json'))
  const unamed = {}
  _.forIn(SPOTS, (spot, id) => {
    if (named[id] != null) {
      // if (SPOTS[named[id]] != null) {
      //   console.warn(`Multiple spot have same name ${named[id]}`)
      // }
      SPOTS[id].name = named[id]
    } else {
      unamed[id] = spot.coord.join('_')
      SPOTS[id].name = unamed[id]
    }
  })
  if (Object.keys(unamed).length > 0) {
    fs.writeJSONSync('spots_unamed.json', unamed)
    console.warn([
      `Unamed spot found! Please set their name in "spots.json"`,
    ].join('\n'))
  }
}

function addSpotDistance() {
  if (!fs.existsSync('celldata.json')) {
    throw new Error(`celldata.json not found!`)
  }
  const MSAPI = fs.readJSONSync('celldata.json')
  for (const {api_no, api_distance} of MSAPI.api_cell_data) {
    if (api_no == null || api_distance == null)
      continue
    const route = ROUTE[api_no]
    const id = route.end.join()
    const spot = SPOTS[id]
    if (spot.tag.includes(api_distance) === false)
      spot.tag.push(api_distance)
  }
}

function drawRoute() {
  DRAWS.push(`
<defs>
  <marker id="arrow" refX="7" refY="2" markerWidth="6" markerHeight="9" orient="auto" markerUnits="strokeWidth">
    <path d="M0,0 L0,4 L7,2 z" fill="#000" />
  </marker>
</defs>`)
  _.forIn(ROUTE, ({start, end}, id) => {
    if (start == null) return
    const s = start.map(n => n / SCALE)
    const e =   end.map(n => n / SCALE)
    const m = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2]
    DRAWS.push(`<line x1="${s[0]}" y1="${s[1]}" x2="${e[0]}" y2="${e[1]}" stroke="black" stroke-width="2" marker-end="url(#arrow)" />`)
    DRAWS.push(`<text x="${m[0]}" y="${m[1]}" font-family="sans-serif" font-size="12">${id}</text>`)
  })
}

function drawSpots() {
  _.forIn(SPOTS, ({coord, start, name, tag}) => {
    const color = start ? "#ff0" : "#dd0"
    const c = coord.map(n => n / SCALE)  // coord
    const t = name + (tag.length > 0 ? `(${tag.join()})` : '')  // text
    const fs = name.length > 1 ? 12 : 16
    DRAWS.push(`<circle cx="${c[0]}" cy="${c[1]}" r="3" style="fill:${color};"/>`)
    DRAWS.push(`<text x="${c[0]}" y="${c[1]+fs}" fill="${color}" font-family="sans-serif" font-weight="bold" font-size="${fs}">${t}</text>`)
  })
}

function drawSpotIcons() {
  if (!fs.existsSync('celldata.json')) {
    throw new Error(`celldata.json not found!`)
  }
  DRAWS.push(
`<defs>
  <image id="spot2"  x="-10.0" y="-10.0" width="20" height="20" xlink:href="spoticons/2.png" />
  <image id="spot3"  x="-10.0" y="-10.0" width="20" height="20" xlink:href="spoticons/3.png" />
  <image id="spot4"  x="-10.0" y="-10.0" width="20" height="20" xlink:href="spoticons/4.png" />
  <image id="spot5"  x="-18.0" y="-25.0" width="37" height="40" xlink:href="spoticons/5.png" />
  <image id="spot6"  x="-10.0" y="-10.0" width="20" height="20" xlink:href="spoticons/6.png" />
  <image id="spot7"  x="-35.0" y="-22.0" width="71" height="45" xlink:href="spoticons/7.png" />
  <image id="spot8"  x="-25.0" y="-25.0" width="49" height="49" xlink:href="spoticons/8.png" />
  <image id="spot9"  x="-10.0" y="-10.0" width="20" height="20" xlink:href="spoticons/9.png" />
  <image id="spot10" x="-24.0" y="-20.0" width="57" height="32" xlink:href="spoticons/10.png"/>
</defs>`)
  const MSAPI = fs.readJSONSync('celldata.json')
  for (const {api_no, api_color_no} of MSAPI.api_cell_data) {
    if (api_color_no < 2 || api_color_no > 10)
      continue
    const route = ROUTE[api_no]
    const spot  = route.end
    spot[0] += 340
    spot[1] += 440
    const [x, y] = spot.map(n => n / SCALE)
    DRAWS.push(`<use xlink:href="#spot${api_color_no}" x="${x}" y="${y}"/>`)
  }
}

function drawDone() {
  if (DRAWS.length > 0) {
    fs.writeFileSync('draw.svg', 
`<?xml version="1.0"?>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="800" height="480">
${DRAWS.join('\n')}
</svg>`)
  }
}

function genpoi() {
  const route = {}
  _.forIn(ROUTE, ({start, end}, id) => {
    route[id] = [
      start ? SPOTS[start.join()].name : null,
      end   ? SPOTS[  end.join()].name : null,
    ]
  })
  const spots = {}
  _.forIn(SPOTS, ({coord, start, name}, id) => {
    let type = start ? 'start' : ''
    spots[name] = [coord[0], coord[1], type]
  })
  fs.writeJSONSync('poi.json', {route, spots})
}


(() => {
  const PROCEDURE = {
    ''      : [extract, addSpotName, fitting, drawRoute, drawSpots, drawDone],
    'icon'  : [extract, addSpotName, fitting, drawSpotIcons, drawDone],
    'dst'   : [extract, addSpotName, addSpotDistance, fitting, drawSpots, drawDone],
    'genpoi': [extract, addSpotName, fitting, genpoi],
  }
  const cmd = process.argv[2] || ''
  for (const proceduce of PROCEDURE[cmd]) {
    proceduce()
  }
})()
