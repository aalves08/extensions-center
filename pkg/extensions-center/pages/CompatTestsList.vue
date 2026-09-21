<script setup lang="ts">
import TestRunsListView from '../components/TestRunsListView.vue';
import { ROUTES, COMPAT_TESTS_FILE, COMPAT_TESTS_REPO } from '../config/constants';
</script>

<template>
  <TestRunsListView
    :title="t('extensionsCenter.compatTests.listTitle')"
    :description="t('extensionsCenter.compatTests.description')"
    empty-key="extensionsCenter.compatTests.empty"
    :repo="COMPAT_TESTS_REPO"
    :workflow-file="COMPAT_TESTS_FILE"
    :detail-route-name="ROUTES.COMPAT_TEST_DETAIL"
  />
</template>
