<!-- Geport uit v1 src/lib/components/SvgIcons.svelte. Wijzigingen: alleen de lege
     script-tag (svelte-check heeft 'm nodig voor een module-declaratie); verder verbatim,
     inclusief v1's eigenaardigheden (geneste <svg id="icon-*"> i.p.v. <symbol> voor
     save/plus/star en het losse icon-retry-symbol buiten de wrapper). -->
<script lang="ts">
</script>
<svg xmlns="http://www.w3.org/2000/svg" style="display: none;">
  <symbol id="icon-truck" viewBox="0 0 16 16" fill="currentColor">
    <path d="M0 3.5A1.5 1.5 0 0 1 1.5 2h9A1.5 1.5 0 0 1 12 3.5V5h1.02a1.5 1.5 0 0 1 1.17.563l1.481 1.85a1.5 1.5 0 0 1 .329.938V10.5a1.5 1.5 0 0 1-1.5 1.5H14a2 2 0 1 1-4 0H5a2 2 0 1 1-3.998-.085A1.5 1.5 0 0 1 0 10.5zm1.294 7.456A1.999 1.999 0 0 1 4.732 11h5.536a2.01 2.01 0 0 1 .732-.732V3.5a.5.5 0 0 0-.5-.5h-9a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .294.456M12 10a2 2 0 0 1 1.732 1h.768a.5.5 0 0 0 .5-.5V8.35a.5.5 0 0 0-.11-.312l-1.48-1.85A.5.5 0 0 0 13.02 6H12zm-9 1a1 1 0 1 0 0 2 1 1 0 0 0 0-2m9 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2" />
  </symbol>

  <symbol id="icon-lightning" viewBox="0 0 24 24" stroke="currentColor" fill="none">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M13 10V3L4 14h7v7l9-11h-7z"
    />
  </symbol>

  <svg xmlns="http://www.w3.org/2000/svg" id="icon-save" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-save-icon lucide-save"><path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/></svg>

  <svg xmlns="http://www.w3.org/2000/svg" id="icon-plus" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-plus-icon lucide-plus"><path d="M5 12h14"/><path d="M12 5v14"/></svg>

  <symbol id="icon-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M18 6L6 18" />
    <path d="M6 6l12 12" />
  </symbol>


  <svg xmlns="http://www.w3.org/2000/svg" id="icon-star" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-star-icon lucide-star"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>

  <symbol id="icon-checkmark" viewBox="0 0 16 16" fill="currentColor">
    <path d="M6.0001 11.2002L2.8001 8.0002L1.86677 8.93353L6.0001 13.0669L15.0001 4.06686L14.0668 3.13353L6.0001 11.2002Z" />
  </symbol>

  <!-- Lucide "archive-restore": archive box with a centered up-arrow. Used on archived
       order rows to mean "take this back out of the archive". Distinct from icon-retry
       (a counter-clockwise loop) so an unarchive on a Gearchiveerd row reads differently
       than the retry action on a Mislukt row. -->
  <symbol id="icon-archive-restore" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <rect width="20" height="5" x="2" y="3" rx="1" />
    <path d="M4 8v10a2 2 0 0 0 2 2h2" />
    <path d="M20 8v11a2 2 0 0 1-2 2h-2" />
    <path d="m9 15 3-3 3 3" />
    <path d="M12 12v9" />
  </symbol>
</svg>

<symbol id="icon-retry" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="1 4 1 10 7 10" />
  <path d="M3.51 15a9 9 0 1 0 .49-5.5L1 10" />
</symbol>
