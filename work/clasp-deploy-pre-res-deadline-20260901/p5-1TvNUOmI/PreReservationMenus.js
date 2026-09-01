function onOpen() {
  if (typeof openPreReservationColorRulesMenu === 'function') {
    openPreReservationColorRulesMenu();
  }
  if (typeof openPreReservationTemplateExtractorMenu === 'function') {
    openPreReservationTemplateExtractorMenu();
  }
  if (typeof openPreReservationTemplateDrivenMailMenu === 'function') {
    openPreReservationTemplateDrivenMailMenu();
  }
}
