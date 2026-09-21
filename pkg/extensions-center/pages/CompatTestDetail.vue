<script setup lang="ts">
import TestRunDetailView from '../components/TestRunDetailView.vue';
import { ROUTES, COMPAT_TESTS_REPO } from '../config/constants';
</script>

<template>
  <TestRunDetailView
    :repo="COMPAT_TESTS_REPO"
    title-key="extensionsCenter.compatTests.detailTitle"
    :list-route-name="ROUTES.COMPAT_TESTS"
  />
</template>
