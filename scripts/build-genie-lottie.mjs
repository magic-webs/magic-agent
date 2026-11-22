import { readFileSync, writeFileSync } from "node:fs";

const [, , basePath, ...outDirs] = process.argv;
const base = JSON.parse(readFileSync(basePath, "utf8"));

const EASE = { o: { x: [0.33, 0.33], y: [0, 0] }, i: { x: [0.67, 0.67], y: [1, 1] } };
const EASE1 = { o: { x: [0.33], y: [0] }, i: { x: [0.67], y: [1] } };
const HOLD_HL = [-14, -15.5];
const EYES = { left: [420, 507.5], right: [721.5, 507] };
const TEAL = [0.08, 0.78, 0.68, 1];
const NAVY = [0.0118, 0.0863, 0.1725, 1];

function track(keys, dims = 2) {
  const sorted = [...new Map(keys.map((k) => [k[0], k])).values()].sort((a, b) => a[0] - b[0]);
  if (sorted.length === 1) return { a: 0, k: sorted[0][1] };
  return {
    a: 1,
    k: sorted.map(([t, s], i) =>
      i === sorted.length - 1 ? { t, s: [].concat(s) } : { t, s: [].concat(s), ...(dims === 1 ? EASE1 : EASE) }
    ),
  };
}

/** keys: [frame, { dx, dy, sx, sy, hl }] — hl is highlight opacity 0..100 */
function eye(name, ind, origin, keys, op) {
  const src = base.layers.find((l) => l.nm === name);
  const layer = structuredClone(src);
  layer.ind = ind;
  layer.ip = 0;
  layer.op = op;
  const pick = (f, d) => keys.map(([t, v]) => [t, f({ dx: 0, dy: 0, sx: 100, sy: 100, hl: 100, ...v })]);
  layer.ks.p = track(pick((v) => [origin[0] + v.dx, origin[1] + v.dy]));
  layer.ks.s = track(pick((v) => [v.sx, v.sy]));
  const hl = layer.shapes.find((g) => g.nm === "highlight");
  const tr = hl.it.find((x) => x.ty === "tr");
  tr.p = track(pick((v) => [HOLD_HL[0] + v.dx * 0.25, HOLD_HL[1] + v.dy * 0.25]));
  tr.o = track(pick((v) => v.hl), 1);
  return layer;
}

function starPath(r) {
  const k = r * 0.22;
  return {
    c: true,
    v: [[0, -r], [k, -k], [r, 0], [k, k], [0, r], [-k, k], [-r, 0], [-k, -k]],
    i: Array(8).fill([0, 0]),
    o: Array(8).fill([0, 0]),
  };
}

function shapeLayer(nm, ind, op, pos, shapes, ks = {}) {
  return {
    ddd: 0, ind, ty: 4, nm, sr: 1, ip: 0, op, st: 0, bm: 0,
    ks: {
      o: ks.o ?? { a: 0, k: 100 },
      r: ks.r ?? { a: 0, k: 0 },
      p: ks.p ?? { a: 0, k: pos },
      a: { a: 0, k: [0, 0] },
      s: ks.s ?? { a: 0, k: [100, 100] },
    },
    shapes,
  };
}

function sparkle(ind, op, pos, r, start) {
  return shapeLayer(
    "Sparkle",
    ind,
    op,
    pos,
    [{ ty: "gr", nm: "star", it: [
      { ty: "sh", nm: "path", ks: { a: 0, k: starPath(r) } },
      { ty: "fl", nm: "fill", c: { a: 0, k: TEAL }, o: { a: 0, k: 100 }, r: 1 },
      { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
    ] }],
    {
      s: track([[0, [0, 0]], [start, [0, 0]], [start + 10, [120, 120]], [start + 16, [100, 100]], [start + 34, [100, 100]], [start + 46, [0, 0]]]),
      r: track([[start, 0], [start + 46, 90]], 1),
    }
  );
}

function zee(ind, op, start, period) {
  const w = 56;
  const path = { c: false, v: [[-w / 2, -w / 2], [w / 2, -w / 2], [-w / 2, w / 2], [w / 2, w / 2]], i: Array(4).fill([0, 0]), o: Array(4).fill([0, 0]) };
  const x0 = 560, y0 = 150;
  return shapeLayer(
    "Z",
    ind,
    op,
    [x0, y0],
    [{ ty: "gr", nm: "z", it: [
      { ty: "sh", nm: "path", ks: { a: 0, k: path } },
      { ty: "st", nm: "stroke", c: { a: 0, k: NAVY }, o: { a: 0, k: 100 }, w: { a: 0, k: 13 }, lc: 2, lj: 2 },
      { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } },
    ] }],
    {
      p: track([[0, [x0, y0]], [start, [x0, y0]], [start + period, [x0 + 40, y0 - 110]], [op, [x0 + 40, y0 - 110]]]),
      s: track([[0, [60, 60]], [start, [60, 60]], [start + period, [110, 110]], [op, [110, 110]]]),
      o: track([[0, 0], [start, 0], [start + 15, 90], [start + period - 20, 70], [start + period, 0], [op, 0]], 1),
      r: { a: 0, k: -12 },
    }
  );
}

function compose(name, op, leftKeys, rightKeys, extras = []) {
  const logo = structuredClone(base.layers.find((l) => l.nm === "Logo"));
  const layers = [
    ...extras.map((make, i) => make(i + 1)),
    eye("Eye Left", extras.length + 1, EYES.left, leftKeys, op),
    eye("Eye Right", extras.length + 2, EYES.right, rightKeys, op),
    { ...logo, ind: extras.length + 3, ip: 0, op },
  ];
  return { ...base, nm: name, ip: 0, op, layers };
}

const N = {};
const blink = (t, v = {}) => [
  [t, v],
  [t + 5, { ...v, sx: 112, sy: 6, hl: 0 }],
  [t + 8, { ...v, sx: 112, sy: 6, hl: 0 }],
  [t + 16, v],
];
const both = (keys) => [keys, keys];

const thinking = (() => {
  const up = { dx: 16, dy: -16 };
  const k = [
    [0, N], [28, up], [70, up],
    [96, { dx: -16, dy: -8 }], [116, { dx: -16, dy: -8 }],
    [138, { dx: 16, dy: -8 }], [150, { dx: 16, dy: -8 }],
    ...blink(152, { dx: 16, dy: -8 }).slice(1),
    [195, N], [210, N],
  ];
  return compose("Genie thinking", 210, ...both(k));
})();

const reading = (() => {
  const k = [[0, N]];
  let t = 10;
  for (const dy of [-12, 0, 12]) {
    k.push([t, { dx: -20, dy }]);
    t += 8;
    for (const dx of [-6, 8, 20]) {
      k.push([t + 10, { dx, dy }], [t + 18, { dx, dy }]);
      t += 18;
    }
    t += 4;
  }
  k.push([t + 16, N], [t + 30, N]);
  return compose("Genie reading", t + 30, ...both(k));
})();

const success = (() => {
  const happy = { dy: -8, sx: 120, sy: 30, hl: 0 };
  const k = [
    [0, N], [8, { dy: -10, sx: 126, sy: 22, hl: 0 }], [14, happy], [52, happy],
    [62, { sx: 96, sy: 106 }], [68, N],
    ...blink(76),
    [96, N],
  ];
  return compose("Genie success", 96, ...both(k), [
    (i) => sparkle(i, 96, [612, 78], 40, 6),
    (i) => sparkle(i, 96, [530, 44], 26, 14),
  ]);
})();

const error = (() => {
  const sad = { dy: 14, sx: 88, sy: 76 };
  const k = [
    [0, N], [12, sad],
    [18, { ...sad, dx: -8 }], [24, { ...sad, dx: 8 }], [30, { ...sad, dx: -8 }], [36, { ...sad, dx: 6 }], [42, sad],
    [62, sad], [74, N],
    ...blink(80),
    [100, N],
  ];
  return compose("Genie error", 100, ...both(k));
})();

const sleepy = (() => {
  const half = { dy: 24, sx: 104, sy: 48, hl: 40 };
  const closed = { dy: 48, sx: 110, sy: 6, hl: 0 };
  const k = [
    [0, half], [70, half], [100, closed], [160, closed],
    [168, { dy: 30, sx: 104, sy: 38, hl: 20 }], [174, { dy: 40, sx: 106, sy: 20, hl: 0 }], [184, half],
    [240, half],
  ];
  return compose("Genie sleepy", 240, ...both(k), [
    (i) => zee(i, 240, 10, 110),
    (i) => zee(i, 240, 90, 110),
    (i) => zee(i, 240, 170, 70),
  ]);
})();

const hello = (() => {
  const wide = { dy: -6, sx: 112, sy: 112 };
  const left = [[0, N], [10, wide], [18, { sx: 98, sy: 98 }], [24, N], [84, N]];
  const right = [
    [0, N], [10, wide], [18, { sx: 98, sy: 98 }], [24, N],
    [32, { dy: 4, sx: 118, sy: 10, hl: 0 }], [48, { dy: 4, sx: 118, sy: 10, hl: 0 }],
    [56, { sx: 96, sy: 104 }], [62, N], [84, N],
  ];
  return compose("Genie hello", 84, left, right);
})();

const listening = (() => {
  const big = { sx: 106, sy: 106 };
  const k = [[0, N], [30, big], [60, N], [90, big], [104, N], ...blink(104).slice(1)];
  return compose("Genie listening", 120, ...both(k));
})();

const out = { thinking, reading, success, error, sleepy, hello, listening };
for (const dir of outDirs) {
  for (const [name, data] of Object.entries(out)) {
    writeFileSync(`${dir}/genie-${name}.json`, JSON.stringify(data));
  }
}
console.log(Object.entries(out).map(([n, d]) => `${n}: ${d.op}f`).join(", "));
