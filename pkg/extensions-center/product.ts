import { IExtension } from '@shell/core/types';
import { ProductMetadata, ProductChild } from '@shell/core/plugin-products-external';

import { PRODUCT_NAME, PRODUCT_ROUTE_NAME, BLANK_CLUSTER, ROUTES } from './config/constants';

const product: ProductMetadata = {
  name:     PRODUCT_NAME,
  labelKey: 'extensionsCenter.product.label',
  sideBar:  {
    weight: 100,
    icon:   { name: 'gear' },
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
    component: () => import('./pages/Dashboard.vue'),
    sideMenu:  { weight: 100 },
  },
  {
    name:      'workflow-tests',
    labelKey:  'extensionsCenter.nav.workflowTests',
    component: () => import('./pages/WorkflowTestsList.vue'),
    sideMenu:  { weight: 90 },
  },
  {
    name:      'compat-tests',
    labelKey:  'extensionsCenter.nav.compatTests',
    component: () => import('./pages/CompatTestsList.vue'),
    sideMenu:  { weight: 80 },
  },
  {
    name:      'known-repos',
    labelKey:  'extensionsCenter.nav.knownRepos',
    component: () => import('./pages/KnownReposList.vue'),
    sideMenu:  { weight: 70 },
  },
  {
    name:      'npm-metrics',
    labelKey:  'extensionsCenter.nav.npmMetrics',
    component: () => import('./pages/NpmMetrics.vue'),
    sideMenu:  { weight: 60 },
  },
  {
    name:      'settings',
    labelKey:  'extensionsCenter.nav.settings',
    component: () => import('./pages/Settings.vue'),
    sideMenu:  { weight: 10 },
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
