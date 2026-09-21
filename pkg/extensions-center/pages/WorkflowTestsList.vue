<script setup lang="ts">
import TestRunsListView from '../components/TestRunsListView.vue';
import { ROUTES, WORKFLOW_TESTS_FILE, WORKFLOW_TESTS_REPO } from '../config/constants';
</script>

<template>
  <TestRunsListView
    :title="t('extensionsCenter.workflowTests.listTitle')"
    :description="t('extensionsCenter.workflowTests.description')"
    empty-key="extensionsCenter.workflowTests.empty"
    :repo="WORKFLOW_TESTS_REPO"
    :workflow-file="WORKFLOW_TESTS_FILE"
    :detail-route-name="ROUTES.WORKFLOW_TEST_DETAIL"
  />
</template>
