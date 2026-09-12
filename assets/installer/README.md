# Mac installer artwork

`mac-background.svg` is the editable layout for the 640 × 400 point Finder
window. The checked-in PNGs supply standard and Retina resolution; electron-builder
combines them into a multi-resolution TIFF. Regenerate on Linux with DejaVu Sans
and DejaVu Serif installed, after `npm ci` and `npx playwright install chromium`:

```sh
node scripts/desktop/render-dmg-artwork.mjs
```

The app and Applications folder are actual Finder items, not painted controls.
Their centers are (176, 246) and (464, 246), with 92-point icons. Keep these
positions synchronized with `desktop/electron-builder.cjs`. Finder supplies the
item names below the icons. Its title bar, tabs and appearance remain controlled
by macOS and the user's preferences.

Application icons on all platforms use the approved README artwork directly:
`assets/logo/greybeard-light.png`. The DMG inherits the app icon for its volume;
the older `greybeard-avatar.png` concept is not used by companion packaging.
