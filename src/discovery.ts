/**
 * Network discovery utilities for finding Supernote devices on the local network
 */

export interface DiscoveredDevice {
	ip: string;
	deviceName: string;
	responseTime: number; // in milliseconds
}

/**
 * Extract subnet from an IP address (e.g., "192.168.86.25" -> "192.168.86")
 */
export function getSubnetFromIP(ip: string): string | null {
	const parts = ip.split('.');
	if (parts.length === 4) {
		return parts.slice(0, 3).join('.');
	}
	return null;
}

/**
 * Check if a given IP has a Supernote device at port 8089
 */
async function probeSupernotDevice(
	ip: string,
	timeoutMs: number = 3000,
): Promise<DiscoveredDevice | null> {
	const startTime = Date.now();
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(`http://${ip}:8089/`, {
			method: 'GET',
			signal: controller.signal,
		});

		clearTimeout(timeoutId);

		if (!response.ok) {
			return null;
		}

		const html = await response.text();

		// Extract the JSON data from the script tag
		const match = html.match(/const json = '(.+?)'/);
		if (!match) {
			return null;
		}

		const data = JSON.parse(match[1]);

		// Verify it's a Supernote device by checking for deviceName field
		if (
			data.deviceName &&
			data.deviceName.toLowerCase().includes('supernote')
		) {
			const responseTime = Date.now() - startTime;
			return {
				ip,
				deviceName: data.deviceName,
				responseTime,
			};
		}

		return null;
	} catch (err) {
		clearTimeout(timeoutId);
		// Connection failed, timeout, or aborted - not a Supernote device
		return null;
	}
}

/**
 * Scan a subnet for Supernote devices
 * @param subnet The subnet to scan (e.g., "192.168.1")
 * @param onProgress Optional callback for progress updates
 * @param stopOnFirst Stop scanning after finding first device
 */
async function scanSubnet(
	subnet: string,
	onProgress?: (current: number, total: number, ip: string) => void,
	stopOnFirst = true,
): Promise<DiscoveredDevice[]> {
	const devices: DiscoveredDevice[] = [];
	const total = 254; // Scan .1 to .254

	// Scan in batches to avoid overwhelming the network
	const batchSize = 5;

	for (let i = 1; i <= 254; i += batchSize) {
		const batch: Promise<DiscoveredDevice | null>[] = [];

		for (let j = i; j < Math.min(i + batchSize, 255); j++) {
			const ip = `${subnet}.${j}`;
			if (onProgress) {
				onProgress(j, total, ip);
			}
			batch.push(probeSupernotDevice(ip, 3000));
		}

		const results = await Promise.all(batch);

		for (const device of results) {
			if (device !== null) {
				devices.push(device);
			}
		}

		// Early termination when device found
		if (stopOnFirst && devices.length > 0) {
			break;
		}
	}

	return devices;
}

/**
 * Discover Supernote devices on the local network
 * @param subnet The subnet to scan (e.g., "192.168.86")
 * @param onProgress Optional callback for progress updates
 * @param stopOnFirst Stop after finding first device (default: true)
 */
export async function discoverSupernoteDevices(
	subnet: string,
	onProgress?: (current: number, total: number, ip: string) => void,
	stopOnFirst = true,
): Promise<DiscoveredDevice[]> {
	const devices = await scanSubnet(subnet, onProgress, stopOnFirst);

	// Sort by response time (fastest first)
	devices.sort((a, b) => a.responseTime - b.responseTime);

	return devices;
}

/**
 * Quick check if the last known IP still has a Supernote device
 */
export async function verifySupernoteDevice(ip: string): Promise<boolean> {
	const device = await probeSupernotDevice(ip, 5000);
	return device !== null;
}
