import { IExtension } from '@shell/core/types';
import { ProductMetadata, ProductChild } from '@shell/core/plugin-products-external';

import { PRODUCT_NAME, PRODUCT_ROUTE_NAME, BLANK_CLUSTER, ROUTES } from './config/constants';

const product: ProductMetadata = {
  name:     PRODUCT_NAME,
  labelKey: 'extensionsCenter.product.label',
  sideBar:  {
    weight: 100,
    icon:   { name: 'os-management' },
  },
  appHeader: {
    hideCopyConfig:      true,
    hideKubeConfig:      true,
    hideKubeShell:       true,
    showClusterInfo:     false,
    showNamespaceFilter: false,
  },
};

const pages: ProductChild[] = [
  {
    name:      'dashboard',
    labelKey:  'extensionsCenter.nav.dashboard',
    component: () => import('./pages/Dashboard.vue')
  },
  {
    name:      'security',
    labelKey:  'extensionsCenter.nav.security',
    component: () => import('./pages/Security.vue')
  },
  // The two analysis pages sit together and in this order deliberately: imports
  // describe what extensions ask for, bundles what they actually ship, and
  // reading the first makes the second easier to interpret.
  {
    name:      'import-analysis',
    labelKey:  'extensionsCenter.nav.importAnalysis',
    component: () => import('./pages/ImportAnalysis.vue')
  },
  {
    name:      'bundle-analysis',
    labelKey:  'extensionsCenter.nav.bundleAnalysis',
    component: () => import('./pages/BundleAnalysis.vue')
  },
  {
    name:      'workflow-tests',
    labelKey:  'extensionsCenter.nav.workflowTests',
    component: () => import('./pages/WorkflowTestsList.vue')
  },
  {
    name:      'compat-tests',
    labelKey:  'extensionsCenter.nav.compatTests',
    component: () => import('./pages/CompatTestsList.vue')
  },
  {
    name:      'known-repos',
    labelKey:  'extensionsCenter.nav.knownRepos',
    component: () => import('./pages/KnownReposList.vue')
  },
  {
    name:      'npm-metrics',
    labelKey:  'extensionsCenter.nav.npmMetrics',
    component: () => import('./pages/NpmMetrics.vue')
  },
  {
    name:      'settings',
    labelKey:  'extensionsCenter.nav.settings',
    component: () => import('./pages/Settings.vue')
  },
];

export default function(plugin: IExtension): void {
  plugin.addProduct(product, pages);

  // Detail pages are reachable from their list views only, so they are
  // registered as plain routes rather than as product children. They follow
  // the same `<product>-c-cluster-<page>` naming the shell generates for the
  // pages above so they resolve inside the product shell.
  //
  // Everything route-facing uses PRODUCT_ROUTE_NAME: the shell registers the
  // product under the hyphen-free name, and `product` here is what it looks the
  // product up by. `meta.pkg` is set by the shell itself in `addRoute`.
  plugin.addRoutes([
    {
      name:      ROUTES.WORKFLOW_TEST_DETAIL,
      path:      `${ PRODUCT_ROUTE_NAME }/c/:cluster/workflow-tests/:runId`,
      component: () => import('./pages/WorkflowTestDetail.vue'),
      params:    {
        product: PRODUCT_ROUTE_NAME,
        cluster: BLANK_CLUSTER,
      },
      meta: {
        product: PRODUCT_ROUTE_NAME,
        cluster: BLANK_CLUSTER,
      },
    },
    {
      name:      ROUTES.COMPAT_TEST_DETAIL,
      path:      `${ PRODUCT_ROUTE_NAME }/c/:cluster/compat-tests/:runId`,
      component: () => import('./pages/CompatTestDetail.vue'),
      params:    {
        product: PRODUCT_ROUTE_NAME,
        cluster: BLANK_CLUSTER,
      },
      meta: {
        product: PRODUCT_ROUTE_NAME,
        cluster: BLANK_CLUSTER,
      },
    },
  ]);
}
