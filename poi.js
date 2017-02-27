
const fs = require('fs-extra')
const path = require('path')

;(() => {
  const final = {}
  for(const fpath of fs.walkSync('./poi')) {
    const m = path.basename(fpath).match(/^(\d+)_(\d+)\.json$/)
    if (m == null) continue
    const area = Number(m[1])
    const cell = Number(m[2])
    final[`${area}-${cell}`] = fs.readJSONSync(fpath)
  }
  fs.writeJSONSync('./poi/final.json', final, {spaces: ''})
})()
