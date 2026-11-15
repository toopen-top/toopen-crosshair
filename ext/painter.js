// Crosshair Overlay — pure painting logic (no St / shell dependencies,
// so it can be unit-tested with plain cairo).

import cairo from 'gi://cairo';

export const TAU = Math.PI * 2;

/**
 * Parse a color string into {red, green, blue, alpha} (channels in 0..1).
 *
 * Accepts the two formats this extension actually produces:
 *   - "#rrggbb"          (schema defaults / CLI --color)
 *   - "rgb(r,g,b)"       (Gtk.ColorDialogButton with alpha disabled)
 *   - "rgba(r,g,b,a)"    (parsed defensively; opacity still comes from the arg)
 *
 * Pure JavaScript so the shell process never needs to import Gdk.
 * Falls back to green so a bad setting never breaks the shell.
 */
export function parseColor(str, alpha = 1.0) {
    const s = String(str ?? '').trim();
    let r = 0;
    let g = 1;
    let b = 0;

    const hex = /^#([0-9a-fA-F]{6})$/.exec(s);
    if (hex) {
        const n = parseInt(hex[1], 16);
        r = ((n >> 16) & 0xff) / 255;
        g = ((n >> 8) & 0xff) / 255;
        b = (n & 0xff) / 255;
    } else {
        // Gtk.ColorDialogButton 写入的是 rgb(r,g,b) / rgba(r,g,b,a)
        const m = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/.exec(s);
        if (m) {
            const chan = v => Math.min(255, Math.max(0, parseFloat(v))) / 255;
            r = chan(m[1]);
            g = chan(m[2]);
            b = chan(m[3]);
        }
    }

    return {red: r, green: g, blue: b, alpha};
}

function strokeCross(cr, cx, cy, arm, gap) {
    if (arm <= 0 || gap >= arm)
        return;
    cr.newPath();
    cr.moveTo(cx - arm, cy);
    cr.lineTo(cx - gap, cy);
    cr.moveTo(cx + gap, cy);
    cr.lineTo(cx + arm, cy);
    cr.moveTo(cx, cy - arm);
    cr.lineTo(cx, cy - gap);
    cr.moveTo(cx, cy + gap);
    cr.lineTo(cx, cy + arm);
    cr.stroke();
}

/**
 * Draw a crosshair centered on a surface.
 *
 * cfg fields (all logical pixels unless noted):
 *   surfaceWidth/surfaceHeight  physical pixels of the drawing surface
 *   monitorWidth/monitorHeight  logical size of the monitor
 *   offsetX/offsetY             shift from the exact center
 *   size, thickness, gap        crosshair geometry
 *   color, opacity              main color
 *   outline, outlineColor       dark backing outline
 *   dot, dotSize                center dot
 *   circle, circleRadius        surrounding ring
 */
export function paintCrosshair(cr, cfg) {
    const {surfaceWidth, surfaceHeight, monitorWidth} = cfg;
    if (surfaceWidth < 2 || surfaceHeight < 2)
        return;

    // Physical pixels per logical pixel. Derived from the real surface size so
    // fractional scaling and multi-monitor setups stay centered.
    const k = monitorWidth > 0 ? surfaceWidth / monitorWidth : 1;
    const cx = surfaceWidth / 2 + (cfg.offsetX ?? 0) * k;
    const cy = surfaceHeight / 2 + (cfg.offsetY ?? 0) * k;

    const arm = Math.max(0, (cfg.size ?? 22) / 2) * k;
    const gap = Math.max(0, (cfg.gap ?? 4) / 2) * k;
    const thickness = Math.max(1, (cfg.thickness ?? 2) * k);
    const opacity = Math.min(1, Math.max(0.05, cfg.opacity ?? 1));
    const radius = Math.max(0, (cfg.circleRadius ?? 11) * k);
    const dotRadius = Math.max(0, (cfg.dotSize ?? 3) / 2) * k;
    const outline = cfg.outline ?? true;
    const outlineWidth = Math.max(1, Math.round(thickness / 2));

    cr.save();
    cr.setLineCap(cairo.LineCap.ROUND);
    cr.setLineJoin(cairo.LineJoin.ROUND);
    cr.setOperator(cairo.Operator.OVER);

    const paint = (colorStr, width, armDelta, gapDelta, radiusDelta) => {
        const c = parseColor(colorStr, opacity);
        cr.setSourceRGBA(c.red, c.green, c.blue, c.alpha);
        cr.setLineWidth(width);
        strokeCross(cr, cx, cy, arm + armDelta, Math.max(0, gap + gapDelta));
        if (cfg.circle) {
            cr.newPath();
            cr.arc(cx, cy, Math.max(0.5, radius), 0, TAU);
            cr.stroke();
        }
        if (cfg.dot) {
            cr.newPath();
            cr.arc(cx, cy, Math.max(0.5, dotRadius + radiusDelta), 0, TAU);
            cr.fill();
        }
    };

    if (outline)
        paint(cfg.outlineColor ?? '#000000', thickness + outlineWidth * 2,
            outlineWidth, outlineWidth, outlineWidth);

    paint(cfg.color ?? '#00ff00', thickness, 0, 0, 0);

    cr.restore();
}
