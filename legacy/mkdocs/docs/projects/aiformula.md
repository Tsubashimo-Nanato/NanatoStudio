# AI Formula Onboarding Manual

<!-- Edit chapter content only in docs/assets/aiformula/text/0.md to 21.md. -->

<details class="download-vault">
  <summary>
    <span class="download-vault__summary-copy">
      <span class="download-vault__summary-eyebrow">Reference Vault</span>
      <span class="download-vault__summary-title">Files, repositories, and cited handoff material</span>
      <span class="download-vault__summary-text">This foldable panel is the single shelf for current and future cited resources used by the handbook.</span>
    </span>
  </summary>
  <div class="download-vault__content">
    <div class="download-vault__group">
      <div class="download-vault__group-head">
        <p class="download-vault__group-title">Official Repositories</p>
        <p class="download-vault__group-note">Use these repository cards when you need baseline source context or Sophia-side extensions behind the manual.</p>
      </div>
      <div class="download-vault__grid">
        <a class="download-card download-card--repo" href="https://github.com/aiformula-support/aiformula" target="_blank" rel="noopener noreferrer">
          <span class="download-card__type">GitHub · Honda</span>
          <strong class="download-card__title">Honda Official Repository</strong>
          <span class="download-card__description">Baseline platform sources, reference launch flow, and Honda-side integration materials.</span>
          <span class="download-card__meta">github.com/aiformula-support/aiformula</span>
          <span class="download-card__action download-card__action--link">Open repository</span>
        </a>
        <a class="download-card download-card--repo" href="https://github.com/SophiaControl/AIformula_sophia" target="_blank" rel="noopener noreferrer">
          <span class="download-card__type">GitHub · Sophia</span>
          <strong class="download-card__title">Sophia Official Repository</strong>
          <span class="download-card__description">Sophia-developed software, experiments, and higher-level project extensions.</span>
          <span class="download-card__meta">github.com/SophiaControl/AIformula_sophia</span>
          <span class="download-card__action download-card__action--link">Open repository</span>
        </a>
      </div>
    </div>
    <div class="download-vault__group">
      <div class="download-vault__group-head">
        <p class="download-vault__group-title">Attachments</p>
        <p class="download-vault__group-note">Add future cited files to this vault so the manual keeps one consistent reference area.</p>
      </div>
      <div class="download-vault__grid">
        <button class="download-card" type="button" data-download-file="01_機体ドキュメント.pdf">
          <span class="download-card__type">PDF · 2.53 MB</span>
          <strong class="download-card__title">Vehicle Document</strong>
          <span class="download-card__description">Primary hardware-side reference for the vehicle platform and its physical baseline.</span>
          <span class="download-card__meta">01_機体ドキュメント.pdf</span>
          <span class="download-card__action">Download file</span>
        </button>
        <button class="download-card" type="button" data-download-file="02_基板詳細.pdf">
          <span class="download-card__type">PDF · 0.94 MB</span>
          <strong class="download-card__title">Board Details</strong>
          <span class="download-card__description">Reference for board-level structure, electronics layout, and related platform details.</span>
          <span class="download-card__meta">02_基板詳細.pdf</span>
          <span class="download-card__action">Download file</span>
        </button>
        <button class="download-card" type="button" data-download-file="03_モータコントローラ.pdf">
          <span class="download-card__type">PDF · 0.99 MB</span>
          <strong class="download-card__title">Motor Controller Guide</strong>
          <span class="download-card__description">Controller-side hardware manual for motor behavior, commands, and expected operating modes.</span>
          <span class="download-card__meta">03_モータコントローラ.pdf</span>
          <span class="download-card__action">Download file</span>
        </button>
        <button class="download-card" type="button" data-download-file="04_CANのコマンド(Ubuntu).pdf">
          <span class="download-card__type">PDF · 0.18 MB</span>
          <strong class="download-card__title">CAN Commands for Ubuntu</strong>
          <span class="download-card__description">Quick command reference for CAN-side communication and Ubuntu usage patterns.</span>
          <span class="download-card__meta">04_CANのコマンド(Ubuntu).pdf</span>
          <span class="download-card__action">Download file</span>
        </button>
        <button class="download-card" type="button" data-download-file="AIFormula説明会.pdf">
          <span class="download-card__type">PDF · 5.61 MB</span>
          <strong class="download-card__title">AI Formula Briefing</strong>
          <span class="download-card__description">Project briefing material for quick orientation and team-level background context.</span>
          <span class="download-card__meta">AIFormula説明会.pdf</span>
          <span class="download-card__action">Download file</span>
        </button>
        <button class="download-card" type="button" data-download-file="AIFormula部品表.pdf">
          <span class="download-card__type">PDF · 0.80 MB</span>
          <strong class="download-card__title">Parts List</strong>
          <span class="download-card__description">Component inventory reference for assembly naming, hardware checks, and part-level discussion.</span>
          <span class="download-card__meta">AIFormula部品表.pdf</span>
          <span class="download-card__action">Download file</span>
        </button>
        <button class="download-card" type="button" data-download-file="AIF_CAN-ID割り当て.xlsx">
          <span class="download-card__type">XLSX · 0.02 MB</span>
          <strong class="download-card__title">CAN ID Allocation Sheet</strong>
          <span class="download-card__description">Spreadsheet reference for CAN ID ownership, mapping, and communication review.</span>
          <span class="download-card__meta">AIF_CAN-ID割り当て.xlsx</span>
          <span class="download-card__action">Download file</span>
        </button>
        <button class="download-card" type="button" data-download-file="RoboteQ_CANマニュアル.pdf">
          <span class="download-card__type">PDF · 6.87 MB</span>
          <strong class="download-card__title">RoboteQ CAN Manual</strong>
          <span class="download-card__description">Vendor manual for CAN behavior, controller semantics, and device-side troubleshooting.</span>
          <span class="download-card__meta">RoboteQ_CANマニュアル.pdf</span>
          <span class="download-card__action">Download file</span>
        </button>
      </div>
    </div>
  </div>
</details>

This document is the project manual for the AI Formula Team of the Control Engineering Lab at Sophia University. Its goal is to help a new team member become productive quickly, understand the system shape, and operate the project safely. It is not a full robotics textbook, and it is not intended to teach vehicle design from first principles.

The content in this part focuses on:

- understanding the project and starting your own work
- what a beginner should do first
- the organization and integration of Honda baseline components and Sophia-developed software
- experimental safety and operating rules
- independent study and the official documentation worth keeping open while working

---

--8<-- "assets/aiformula/text/0.md"
--8<-- "assets/aiformula/text/1.md"
--8<-- "assets/aiformula/text/2.md"
--8<-- "assets/aiformula/text/3.md"
--8<-- "assets/aiformula/text/4.md"
--8<-- "assets/aiformula/text/5.md"
--8<-- "assets/aiformula/text/6.md"
--8<-- "assets/aiformula/text/7.md"
--8<-- "assets/aiformula/text/8.md"
--8<-- "assets/aiformula/text/9.md"
--8<-- "assets/aiformula/text/10.md"
--8<-- "assets/aiformula/text/11.md"
--8<-- "assets/aiformula/text/12.md"
--8<-- "assets/aiformula/text/13.md"
--8<-- "assets/aiformula/text/14.md"
--8<-- "assets/aiformula/text/15.md"
--8<-- "assets/aiformula/text/16.md"
--8<-- "assets/aiformula/text/17.md"
--8<-- "assets/aiformula/text/18.md"
--8<-- "assets/aiformula/text/19.md"
--8<-- "assets/aiformula/text/20.md"
--8<-- "assets/aiformula/text/21.md"
