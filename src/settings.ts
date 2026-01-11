import {
	createCustomDictionarySettingsUI,
	CUSTOM_DICTIONARY_DEFAULT_SETTINGS,
	CustomDictionarySettings,
} from './customDictionary';
import SupernotePlugin from './main';
import {
	App,
	ExtraButtonComponent,
	PluginSettingTab,
	Setting,
	Notice,
	Modal,
} from 'obsidian';
import {
	discoverSupernoteDevices,
	DiscoveredDevice,
	getSubnetFromIP,
} from './discovery';

export const IP_VALIDATION_PATTERN =
	/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/;

export interface SupernotePluginSettings extends CustomDictionarySettings {
	directConnectIP: string;
	invertColorsWhenDark: boolean;
	showTOC: boolean;
	showExportButtons: boolean;
	collapseRecognizedText: boolean;
	noteImageMaxDim: number;
	scanForAllDevices: boolean;
}

export const DEFAULT_SETTINGS: SupernotePluginSettings = {
	directConnectIP: '',
	invertColorsWhenDark: true,
	showTOC: true,
	showExportButtons: true,
	collapseRecognizedText: false,
	noteImageMaxDim: 800, // Sensible default for Nomad pages to be legible but not too big. Unit: px
	scanForAllDevices: false,
	...CUSTOM_DICTIONARY_DEFAULT_SETTINGS,
};

export class SupernoteSettingTab extends PluginSettingTab {
	plugin: SupernotePlugin;

	constructor(app: App, plugin: SupernotePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	showDeviceSelectionModal(devices: DiscoveredDevice[]): void {
		const modal = new DeviceSelectionModal(
			this.app,
			devices,
			async (selectedDevice) => {
				this.plugin.settings.directConnectIP = selectedDevice.ip;
				await this.plugin.saveSettings();
				this.display(); // Refresh the settings display
				new Notice(
					`Selected: ${selectedDevice.deviceName} at ${selectedDevice.ip}`,
				);
			},
		);
		modal.open();
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();
		let alert: ExtraButtonComponent;

		new Setting(containerEl)
			.setName('Supernote IP address')
			.setDesc(
				'(Optional) When using the Supernote "Browse and Access" for document upload/download or "Screen Mirroring" screenshot attachment this is the IP of the Supernote device',
			)
			.addText((text) =>
				text
					.setPlaceholder('IP only e.g. 192.168.1.2')
					.setValue(this.plugin.settings.directConnectIP)
					.onChange(async (value) => {
						if (IP_VALIDATION_PATTERN.test(value) || value === '') {
							this.plugin.settings.directConnectIP = value;
							alert.extraSettingsEl.style.display = 'none';
							await this.plugin.saveSettings();
						} else {
							alert.extraSettingsEl.style.display = 'inline';
						}
					})
					.inputEl.setAttribute('pattern', IP_VALIDATION_PATTERN.source),
			)
			.addExtraButton((btn) => {
				btn
					.setIcon('alert-triangle')
					.setTooltip('Invalid IP format: must be xxx.xxx.xxx.xxx');
				btn.extraSettingsEl.style.display = 'none';
				alert = btn;
				return btn;
			})
			.addButton((btn) => {
				btn
					.setButtonText('Discover')
					.setTooltip('Scan network for Supernote devices')
					.onClick(async () => {
						// Determine which subnet to scan
						let subnet: string | null = null;

						if (this.plugin.settings.directConnectIP) {
							// Extract subnet from existing IP
							subnet = getSubnetFromIP(this.plugin.settings.directConnectIP);
						}

						if (!subnet) {
							// No IP configured - show instructions
							new Notice(
								'Please check your Supernote device for its IP address:\nSwipe down from top → Press the Browse & Access icon',
								5000,
							);
							return;
						}

						btn.setDisabled(true);
						btn.setButtonText('Scanning...');

						const notice = new Notice(
							`Scanning ${subnet}.x for Supernote devices...`,
							0,
						);

						// Buffer for last 5 IPs tested
						const recentIPs: string[] = [];

						try {
							const devices = await discoverSupernoteDevices(
								subnet,
								(current, total, ip) => {
									// Maintain rolling buffer of last 5 IPs
									recentIPs.push(ip);
									if (recentIPs.length > 5) {
										recentIPs.shift(); // Remove oldest
									}

									// Display progress with recent IPs (vertical list)
									const ipList = recentIPs.join('\n');
									notice.setMessage(
										`Scanning ${subnet}.x (${Math.round((current / total) * 100)}%)\n` +
											`Recent IPs:\n${ipList}`,
									);
								},
								!this.plugin.settings.scanForAllDevices, // stopOnFirst = opposite of scanForAllDevices
							);

							notice.hide();

							if (devices.length === 0) {
								new Notice(
									`No Supernote devices found on ${subnet}.x\nMake sure "Browse & Access" is enabled on your device.`,
									5000,
								);
							} else if (devices.length === 1) {
								// Auto-select the only device found
								this.plugin.settings.directConnectIP = devices[0].ip;
								await this.plugin.saveSettings();
								this.display(); // Refresh the settings display
								new Notice(
									`Found: ${devices[0].deviceName} at ${devices[0].ip}`,
								);
							} else {
								// Multiple devices found - let user choose
								this.showDeviceSelectionModal(devices);
							}
						} catch (err) {
							notice.hide();
							new Notice(`Discovery failed: ${err.message}`);
						} finally {
							btn.setDisabled(false);
							btn.setButtonText('Discover');
						}
					});
			});

		new Setting(containerEl)
			.setName('Scan for all devices')
			.setDesc(
				'When discovering devices, scan the entire subnet for all Supernote devices. If disabled, scanning stops after finding the first device (faster, uses less CPU).',
			)
			.addToggle((text) =>
				text
					.setValue(this.plugin.settings.scanForAllDevices)
					.onChange(async (value) => {
						this.plugin.settings.scanForAllDevices = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Invert colors in "Dark mode"')
			.setDesc(
				'When Obsidian is in "Dark mode" increase image visibility by inverting colors of images',
			)
			.addToggle((text) =>
				text
					.setValue(this.plugin.settings.invertColorsWhenDark)
					.onChange(async (value) => {
						this.plugin.settings.invertColorsWhenDark = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Show table of contents and page headings')
			.setDesc(
				'When viewing .note files, show a table of contents and page number headings',
			)
			.addToggle((text) =>
				text.setValue(this.plugin.settings.showTOC).onChange(async (value) => {
					this.plugin.settings.showTOC = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName('Show export buttons')
			.setDesc(
				'When viewing .note files, show buttons for exporting images and/or markdown files to vault. These features can still be accessed via the command pallete.',
			)
			.addToggle((text) =>
				text
					.setValue(this.plugin.settings.showExportButtons)
					.onChange(async (value) => {
						this.plugin.settings.showExportButtons = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Collapse recognized text')
			.setDesc(
				'When viewing .note files, hide recognized text in a collapsible element. This does not affect exported markdown.',
			)
			.addToggle((text) =>
				text
					.setValue(this.plugin.settings.collapseRecognizedText)
					.onChange(async (value) => {
						this.plugin.settings.collapseRecognizedText = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Max image side length in .note files')
			.setDesc(
				'Maximum width and height (in pixels) of the note image when viewing .note files. Does not affect exported images and markdown.',
			)
			.addSlider((text) =>
				text
					.setLimits(200, 1900, 100) // Resolution of an A5X/A6X2/Nomad page is 1404 x 1872 px (with no upscaling)
					.setDynamicTooltip()
					.setValue(this.plugin.settings.noteImageMaxDim)
					.onChange(async (value) => {
						this.plugin.settings.noteImageMaxDim = value;
						await this.plugin.saveSettings();
					}),
			);

		// Add custom dictionary settings to the settings tab
		createCustomDictionarySettingsUI(containerEl, this.plugin);
	}
}

class DeviceSelectionModal extends Modal {
	devices: DiscoveredDevice[];
	onSelect: (device: DiscoveredDevice) => void;

	constructor(
		app: App,
		devices: DiscoveredDevice[],
		onSelect: (device: DiscoveredDevice) => void,
	) {
		super(app);
		this.devices = devices;
		this.onSelect = onSelect;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Select Supernote Device' });
		contentEl.createEl('p', { text: `Found ${this.devices.length} devices:` });

		const listEl = contentEl.createEl('div', { cls: 'supernote-device-list' });

		this.devices.forEach((device) => {
			const deviceEl = listEl.createEl('div', { cls: 'supernote-device-item' });
			deviceEl.style.padding = '10px';
			deviceEl.style.margin = '5px 0';
			deviceEl.style.border = '1px solid var(--background-modifier-border)';
			deviceEl.style.borderRadius = '5px';
			deviceEl.style.cursor = 'pointer';

			deviceEl.createEl('div', {
				text: device.deviceName,
				cls: 'supernote-device-name',
			});
			deviceEl.createEl('div', {
				text: `IP: ${device.ip} (${device.responseTime}ms)`,
				cls: 'supernote-device-info',
			});

			deviceEl.addEventListener('click', () => {
				this.onSelect(device);
				this.close();
			});

			deviceEl.addEventListener('mouseenter', () => {
				deviceEl.style.backgroundColor = 'var(--background-modifier-hover)';
			});

			deviceEl.addEventListener('mouseleave', () => {
				deviceEl.style.backgroundColor = '';
			});
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
