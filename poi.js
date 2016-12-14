
const fs = require('fs-extra')
const path = require('path')

function safeParseInt(string) {
  const number = Number(string)
  if (Number.isNaN(number)) {
    throw new Error(`Parse int failed: ${string}`)
  }
  return number
}

(() => {
  const final = {}
  for(const fpath of fs.walkSync('./poi')) {
    const m = path.basename(fpath).match(/^(\d+)_(\d+)\.json$/)
    if (m == null) continue
    area = safeParseInt(m[1])
    cell = safeParseInt(m[2])
    final[`${area}-${cell}`] = fs.readJSONSync(fpath)
  }
  fs.writeJSONSync('./poi/final.json', final, {spaces: ''})
})()
