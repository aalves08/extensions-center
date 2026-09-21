<script setup lang="ts">
import TestRunDetailView from '../components/TestRunDetailView.vue';
import { ROUTES, WORKFLOW_TESTS_REPO } from '../config/constants';
</script>

<template>
  <TestRunDetailView
    :repo="WORKFLOW_TESTS_REPO"
    title-key="extensionsCenter.workflowTests.detailTitle"
    :list-route-name="ROUTES.WORKFLOW_TESTS"
  />
</template>
