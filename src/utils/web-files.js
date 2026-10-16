export function pickWebFiles(accept, multiple = false) {
  return new Promise(resolve => {
    // #ifdef H5
    const input = document.createElement('input')
    input.type = 'file'; input.accept = accept; input.multiple = multiple
    input.style.display = 'none'
    document.body.appendChild(input)
    input.onchange = () => { const files = Array.from(input.files || []); input.remove(); resolve(files) }
    input.oncancel = () => { input.remove(); resolve([]) }
    input.click()
    // #endif
  })
}
