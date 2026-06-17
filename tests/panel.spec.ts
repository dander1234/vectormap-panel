import { test, expect } from '@grafana/plugin-e2e';

// These tests replace the scaffold's "simple-panel" example tests. They target
// the real Vectormap panel: the panel root carries data-testid="vectormap-panel"
// and always renders the basemap plus a "Set initial view" button, regardless of
// whether any query returns data.

test('provisioned Vectormap panel renders', async ({ gotoPanelEditPage, readProvisionedDashboard }) => {
  const dashboard = await readProvisionedDashboard({ fileName: 'dashboard.json' });
  // The provisioned "Vectormap demo" dashboard has a single Vectormap panel (id 1).
  const panelEditPage = await gotoPanelEditPage({ dashboard, id: '1' });
  await expect(panelEditPage.panel.locator.getByTestId('vectormap-panel')).toBeVisible();
});

test('Vectormap is selectable as a visualization and mounts', async ({ panelEditPage, page }) => {
  await panelEditPage.setVisualization('Vectormap');
  // The panel root mounts and the always-present control is shown.
  await expect(page.getByTestId('vectormap-panel')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set initial view' })).toBeVisible();
});
