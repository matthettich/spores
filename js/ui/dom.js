/* js/ui/dom.js: tiny DOM helpers for the screens (no framework).
 *   el('button', {class: 'tb', onclick: fn}, 'Play')   → an element
 *   el('div', {}, el('span'), 'text', [more])          → children, nested arrays flattened
 */
export function el(tag, props, ...kids){
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})){
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'style') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  add(n, kids);
  return n;
}

function add(n, kids){
  for (const kid of kids){
    if (kid == null || kid === false) continue;
    if (Array.isArray(kid)) add(n, kid);
    else if (kid.nodeType) n.append(kid);
    else n.append(document.createTextNode(String(kid)));
  }
}
