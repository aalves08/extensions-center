import { importTypes } from '@rancher/auto-import';
import { IExtension } from '@shell/core/types';

import product from './product';

// Init the package
export default function(plugin: IExtension): void {
  // Auto-import model, detail, edit from the folders
  importTypes(plugin);

  // Provide plugin metadata from package.json
  plugin.metadata = require('./package.json');

  // Register the Extensions Center product, its pages and its routes
  product(plugin);
}
