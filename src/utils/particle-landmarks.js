const TAU = Math.PI * 2
const fraction = value => value - Math.floor(value)
const mix = (a, b, t) => a + (b - a) * t
const line = (a, b, t) => a.map((value, axis) => mix(value, b[axis], t))

// The fourth coordinate marks edges: the renderer keeps them crisp at every quality.
function ring(x, y, z, radius, angle, edge = true) {
  return [x + radius * Math.cos(angle), y, z + radius * Math.sin(angle), edge]
}
function box(x, bottom, z, width, depth, height, u, v, edge = false) {
  const side = Math.floor(v * 4), along = (v * 4 % 1) * 2 - 1
  return [x + (side % 2 ? (side === 1 ? width : -width) : along * width), bottom - u * height,
    z + (side % 2 ? along * depth : (side === 0 ? depth : -depth)), edge]
}
function cross(x, y, z, size, u, v) {
  return v < .65 ? [x, y - u * size, z, true] : [x + (u - .5) * size * .65, y - size * .65, z, true]
}
function pediment(width, bottom, height, front, back, u, v) {
  if (v > .72) {
    const x = (u * 2 - 1) * width
    return [x, bottom - (1 - Math.abs(x) / width) * height * (v - .72) / .28, front, false]
  }
  if (v < .7) {
    const side = v < .35 ? -1 : 1
    return [side * width * u, bottom - height * (1 - u), front, true]
  }
  return [(u * 2 - 1) * width, bottom, mix(front, back, (v - .7) / .3), true]
}

export const DETAILED_LANDMARKS = ['pantheon', 'stbasil', 'stpaul', 'colosseum', 'greatwall', 'tiantan']
export const LANDMARK_VIEWS = {
  pantheon: [.28, .14], stbasil: [.16, .08], stpaul: [.28, .12],
  colosseum: [.24, .32], greatwall: [.1, .36], tiantan: [.12, .1],
}

function pantheon(u, v, w, part) {
  if (part < .25) {
    const column = Math.floor(w * 8), x = -.84 + column * .24
    const collar = v < .25
    return ring(x, collar ? (v < .125 ? .58 : -.13) : mix(.58, -.13, u), -.72,
      collar ? .061 : .038, (collar ? u : v) * TAU, collar)
  }
  if (part < .4) return pediment(.99, -.2, .44, -.83, -.38, u, v)
  if (part < .61) {
    const angle = u * Math.PI / 2, radius = .82 * Math.cos(angle)
    return ring(0, -.27 - .52 * Math.sin(angle), .31, radius, v * TAU, v < .15)
  }
  if (part < .84) {
    const tier = Math.floor(v * 5)
    return ring(0, v < .35 ? mix(.58, -.25, u) : .58 - tier * .205, .31, .82, (v < .35 ? v / .35 : u) * TAU, v >= .35)
  }
  if (part < .94) return box(0, .61, -.57, 1.02, .3, .07, u, v, true)
  // The open entrance is framed rather than filled with a solid point cloud.
  return v < .5 ? [v < .25 ? -.16 : .16, mix(.58, .02, u), -.55, true] : [mix(-.16, .16, u), .02, -.55, true]
}

function stBasil(u, v, w, part) {
  if (part < .08) return box(0, .9, 0, .97, .66, .12, u, v, true)
  const tower = Math.floor(w * 9)
  const angle = (tower - 1) * TAU / 8
  const center = tower === 0
  const x = center ? 0 : Math.cos(angle) * .69, z = center ? .15 : Math.sin(angle) * .51
  const large = !center && tower % 2 === 1
  const radius = center ? .22 : large ? .215 : .14
  const top = center ? -.63 : large ? -.27 : -.08
  if (part < .41) {
    const facet = v < .35 ? Math.floor(v / .35 * 8) * TAU / 8 : (v - .35) / .65 * TAU
    return ring(x, mix(.77, top + .12, u), z, radius * .76, facet, v < .35)
  }
  if (center) {
    if (part > .94) return cross(x, -1.13, z, .17, u, v)
    const r = .24 * (1 - u), a = v < .4 ? Math.floor(w * 8) * TAU / 8 : v * TAU
    return ring(x, mix(-.51, -1.13, u), z, r, a, v < .4)
  }
  if (part > .94) return cross(x, top - .43, z, .14, u, v)
  if (part < .5) return ring(x, top + .09, z, radius * .87, u * TAU)
  const height = v > .78 ? (v > .89 ? .3 : .56) : u
  const r = radius * Math.pow(Math.sin(height * Math.PI), .78) * (1 + .22 * Math.sin(height * Math.PI))
  const a = v < .42 ? Math.floor(v / .42 * 9) * TAU / 9 + height * .85 : v > .78 ? u * TAU : (v - .42) / .36 * TAU
  return ring(x, top + .09 - height * .52, z, r, a, v < .42 || v > .78)
}

function stPaul(u, v, w, part) {
  // The nave, roof and solid drum overlap: no floating dome above an empty band.
  if (part < .26) return box(0, .78, .18, .67, .94, .72, u, v, false)
  if (part < .36) {
    const x = (u * 2 - 1) * .67
    return [x, .06 - .16 * (1 - Math.abs(x) / .67), mix(-.76, 1.12, v), false]
  }
  if (part < .48) {
    const column = Math.floor(w * 16), a = column * TAU / 16
    return v < .45 ? ring(0, mix(.14, -.42, u), .28, .355, v / .45 * TAU, false)
      : ring(0, mix(.14, -.42, u), .28, .38, a, true)
  }
  if (part < .64) {
    const a = u * Math.PI / 2, r = .45 * Math.cos(a)
    return ring(0, -.43 - .49 * Math.sin(a), .28, r, v < .35 ? Math.floor(v / .35 * 16) * TAU / 16 : v * TAU, v < .35)
  }
  if (part < .69) {
    if (v < .25) return cross(0, -1.04, .28, .18, u, v * 4)
    return ring(0, mix(-.91, -1.04, u), .28, .075, v * TAU, true)
  }
  if (part < .86) {
    const x = w < .5 ? -.72 : .72
    if (v < .48) return box(x, .77, -.66, .16, .18, 1.08, u, v / .48, true)
    if (v < .88) return ring(x, mix(-.31, -.61, u), -.66, .14 * (1 - .6 * u), v * TAU, true)
    return cross(x, -.61, -.66, .14, u, (v - .88) / .12)
  }
  if (part < .92) return pediment(.57, .04, .24, -.86, -.58, u, v)
  if (part < .97) {
    const column = Math.floor(w * 6)
    return ring(-.47 + column * .188, mix(.75, .08, u), -.83, .026, v * TAU, true)
  }
  return box(0, .85, -.72, .95, .28, .07, u, v, true)
}

function colosseum(u, v, w, part) {
  const arches = 36, tier = Math.floor(w * 3), bottom = .72 - tier * .39
  const bay = Math.floor(v * arches), center = (bay + .5) * TAU / arches
  const place = (angle, y, inset = 0) => [(1.27 - inset) * Math.cos(angle), y, (.87 - inset) * Math.sin(angle), true]
  if (part < .66) {
    if (u < .4) return place(center - .061, bottom - u / .4 * .19)
    if (u < .8) return place(center + .061, bottom - (u - .4) / .4 * .19)
    const a = (u - .8) / .2 * Math.PI
    return place(center - Math.cos(a) * .061, bottom - .19 - Math.sin(a) * .105)
  }
  if (part < .84) return place(u * TAU, bottom - .35)
  if (part < .94) {
    const a = u * TAU
    // A lower, broken front rim leaves the arena open in the default view.
    const top = Math.sin(a) < -.2 ? -.36 : -.6
    return place(a, mix(top, top - .13, v))
  }
  const a = u * TAU, inset = .18 + Math.floor(v * 4) * .12
  return place(a, .65 - Math.floor(v * 4) * .065, inset)
}

function wallPath(t) {
  return [mix(-1.42, 1.42, t), .08 + .22 * Math.sin(t * Math.PI * 3.2), Math.sin(t * TAU - .3) * .53]
}
function greatWall(u, v, w, part) {
  if (part < .37) {
    const tower = Math.floor(w * 4), center = wallPath([.08, .35, .65, .93][tower])
    if (v < .62) return box(center[0], center[1] + .07, center[2], .17, .2, .42, u, v / .62, v < .2)
    const edge = box(center[0], center[1] - .35, center[2], .19, .22, 0, 0, u, true)
    edge[1] -= Math.floor(v * 55) % 2 ? .075 : 0
    return edge
  }
  const t = u, center = wallPath(t)
  const dx = 2.84, dz = Math.cos(t * TAU - .3) * .53 * TAU, length = Math.hypot(dx, dz)
  const nx = -dz / length, nz = dx / length
  const side = v < .5 ? -1 : 1, offset = side * .115
  if (part < .57) return [center[0] + nx * (v - .5) * .2, center[1], center[2] + nz * (v - .5) * .2, false]
  if (part < .82) return [center[0] + nx * offset, center[1] + .33 * fraction(v * 2), center[2] + nz * offset, false]
  const crenel = Math.floor(t * 72) % 2 === 0
  return [center[0] + nx * offset, center[1] - .12 - (crenel ? .065 : 0), center[2] + nz * offset, true]
}

function templeOfHeaven(u, v, w, part) {
  const tier = Math.floor(w * 3), angle = v * TAU
  if (part < .5) {
    const radius = [.76, .61, .46][tier], eave = [.16, -.22, -.59][tier]
    const radial = part < .2 ? 1 : u
    const r = .045 + (radius - .045) * radial
    const y = eave - .31 * Math.pow(1 - radial, .72) - .045 * Math.pow(radial, 12)
    const a = part > .4 ? Math.floor(v * 40) * TAU / 40 : angle
    return ring(0, y, 0, r, a, part < .2 || part > .4)
  }
  if (part < .64) {
    const column = Math.floor(v * 20) * TAU / 20
    return ring(0, mix(.57, .12, u), 0, .57, column, true)
  }
  if (part < .73) {
    if (part < .69) return ring(0, mix(.55, .19, u), 0, .55, angle, false)
    const upper = w < .5
    return ring(0, upper ? mix(-.48, -.66, u) : mix(-.1, -.29, u), 0, upper ? .29 : .43,
      Math.floor(v * 24) * TAU / 24, true)
  }
  if (part < .96) {
    const radius = [.85, 1, 1.14][tier], y = [.63, .77, .91][tier]
    if (part < .84) return ring(0, y, 0, radius, u * TAU)
    if (part < .91) return ring(0, y - .1, 0, radius - .035, u * TAU)
    return ring(0, y - u * .1, 0, radius - .035, Math.floor(v * 48) * TAU / 48)
  }
  if (part < .98) return [mix(-.15, .15, u), .95 - Math.floor(v * 9) * .035, -1.1 + v * .43, true]
  return ring(0, mix(-.9, -1.12, u), 0, .045 * Math.sin(u * Math.PI), angle)
}

const generators = { pantheon, stbasil: stBasil, stpaul: stPaul, colosseum, greatwall: greatWall, tiantan: templeOfHeaven }
export function landmarkPoint(shape, index) {
  const generate = generators[shape]
  if (!generate) return null
  return generate(fraction((index + .5) * .61803398875), fraction((index + .5) * .41421356237),
    fraction((index + .5) * .73205080757), fraction((index + .5) * .754877666246))
}
