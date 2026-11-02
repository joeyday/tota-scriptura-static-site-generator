/*!
 * The mop icons are Lucide's (https://lucide.dev), ISC license, Copyright (c) 2026 Lucide Icons and
 * Contributors. Permission to use, copy, modify, and/or distribute them for any purpose with or without
 * fee is hereby granted, provided that this copyright notice and permission notice appear in all copies.
 * THE ICONS ARE PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES.
 */

// Obsidian's own icons are an older Lucide than the one that has the mop, so the plugin brings
// them. Lucide draws on a 24 by 24 grid and `addIcon` takes a 100 by 100 one, hence the scale. The
// stroke is Obsidian's own width for its icons, so these sit with the rest.
const lucide = (paths) =>
  `<g transform="scale(4.1667)" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" style="stroke-width: var(--icon-stroke, 1.75)">${paths}</g>`

export const MOP = 'tota-mop'
export const MOP_SPARKLES = 'tota-mop-sparkles'

export const ICONS = {
  [MOP]: lucide(`
    <path d="M10 22c2.761 0 5-1.79 5-4-4.42 0-4.08-5-8.5-5a1 1 0 100 9za3 3 0 01-3-3" />
    <path d="M12.5 11.5 22 2" />
    <path d="m6.98 13.02 2.665-2.664a1.21 1.21 0 011.71 0l2.29 2.288a1.21 1.21 0 010 1.712l-2.088 2.087" />`),
  [MOP_SPARKLES]: lucide(`
    <path d="M10 22a3 3 0 01-3-3" />
    <path d="M10 22c2.761 0 5-1.79 5-4-4.42 0-4.08-5-8.5-5a4.501 4.501 0 000 9z" />
    <path d="M10 3H8" />
    <path d="M12.5 11.5 22 2" />
    <path d="M20 13v4" />
    <path d="M22 15h-4" />
    <path d="M4 5v4" />
    <path d="M6 7H2" />
    <path d="m6.98 13.02 2.665-2.664a1.21 1.21 0 011.71 0l2.29 2.288a1.21 1.21 0 010 1.712l-2.088 2.087" />
    <path d="M9 2v2" />`)
}
