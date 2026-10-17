import fs from 'node:fs';
import { checkedPresentation } from './theme.js';
import { fxOverlay } from '../../../public/studio/js/presentation.js';
import { operatorRecord } from './operator.js';
import { officialEffects } from '../presentationData.js';
import { StudioError } from '../files.js';
import { jsonText } from '../gameData.js';

export default {
  id: 'fx', class: 'content', kinds: ['operator'], slots: () => [], overlay: () => ({}),
  build(args) {
    const { id, options, publicDir } = args;
    const o = checkedPresentation('fx', id, args.target, { kitRef: args.target?.key || 'char_102_texas', ...options });
    // [ASSUMED] A borrowed official kit is the immediately playable carrier for this presentation template.
    const record = operatorRecord({ ...args, options: { kitRef: o.kitRef } });
    const manifest = { scope: ['room'], permissions: ['data.add'], operators: ['data/operator.json'] };
    const files = {};
    if (o.source === 'official') {
      const unit = officialEffects(publicDir).find(u => u.key === o.unit);
      if (!unit || Object.values(o.skills).some(s => !unit.skills.includes(s))) throw new StudioError('PLUGIN_RECORD_TYPE', 400, { where: 'fx', detail: 'Choose a unit and skills present in the local effects index' });
      record.fx = { unit: o.unit, skills: o.skills };
    } else {
      manifest.permissions.push('assets.add');
      manifest.assets = fxOverlay(id, o);
      // Original CC0 checkerboard, not game art. Existing uploaded paths are never overwritten on save.
      if (options.flipbooks === undefined) files['fx/flash.png'] = fs.readFileSync(new URL('../../../plugins/_template/cosmetic/media/sample.png', import.meta.url));
    }
    files['data/operator.json'] = jsonText(record);
    return { manifest, files, options: o };
  },
};
