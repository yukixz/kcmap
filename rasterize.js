const fs = require('fs')
const page = require('webpage').create()
const system = require('system')

const input  = system.args[1]
const output = system.args[2]
page.viewportSize = { width: 800, height: 600 }

// Get image size
;(function() {
  const data = fs.read(input)
  const frag = document.createElement('div')
  frag.innerHTML = data;
  const svg = frag.querySelector('svg')
  const width   = svg.getAttribute('width')
  const height  = svg.getAttribute('height')
  const viewbox = svg.getAttribute('viewBox')
  page.viewportSize = { width: width, height: height }
})()

// Render
;(function() {
  page.open(input, function(status) {
    if (status !== 'success') {
      console.error('Unable to load the address!')
      phantom.exit(1)
    }
    setTimeout(function() {
      page.render(output)
      phantom.exit()
    }, 200)
  })
})()
