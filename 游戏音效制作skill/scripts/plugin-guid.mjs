#!/usr/bin/env node
/**
 * Print the ForgeaX asset GUID for a Pack build key (needed for the one registration line in a parent
 * plugin's `children`). Run from the game root so `@forgeax/engine` resolves:
 *   cp plugin-guid.mjs <game>/.g.tmp.mjs && (cd <game> && node .g.tmp.mjs <packageId> plugin/audio); rm <game>/.g.tmp.mjs
 */
import { AssetGuid } from '@forgeax/engine/pack/guid';
import { definePackageId } from '@forgeax/engine/pack/source';
const [pkg, key] = process.argv.slice(2);
if (!pkg || !key) { console.error('usage: node plugin-guid.mjs <packageId-uuid> <sourceKey e.g. plugin/audio>'); process.exit(2); }
console.log(AssetGuid.format(AssetGuid.derive(definePackageId(pkg), key)));
