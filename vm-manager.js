#!/usr/bin/env node
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE_PATH = path.join(__dirname, 'config.json');

async function main() {
	const args = process.argv.slice(2);

	// Usage instructions for the script
	if (args.length < 1 || args.length > 2 || 
		(args[0].toLowerCase() === 'status' && args.length === 2) ) {
		console.log('Usage: node vm-manager.js <suspend|resume> <VM_ID|- (all VMs)>');
		console.log('       node vm-manager.js status');
		console.log('Example: node vm-manager.js resume vm1');
		console.log('Example: node vm-manager.js suspend -');
		console.log('Example: node vm-manager.js status');
		process.exit(1);
	}

	const action = args[0].toLowerCase();
	const vmId = args[1];

	// Validate the action
	if (!['suspend', 'resume', 'status'].includes(action)) {
		console.error('Error: Action must be "suspend", "resume", or "status".');
		process.exit(1);
	}

	let configData;
	try {
		const configRaw = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
		configData = JSON.parse(configRaw);

		// Validate config file format
		if (!configData.vmrunPath || !Array.isArray(configData.virtualMachines)) {
			console.error('Error: Invalid config.json format. Missing "vmrunPath" or "virtualMachines" array.');
			process.exit(1);
		}

	} catch (error) {
		console.error('Error: Failed to read or parse config.json.');
		console.error(error.message);
		process.exit(1);
	}

	const VMWARE_VMRUN_PATH = `"${configData.vmrunPath}"`;
	const vmList = configData.virtualMachines;

	switch (action) {
		case "suspend":
		case "resume":
			if (!vmId) {
				console.error(`Error: VM_ID (or '-') is required for "${action}" action.`);
				process.exit(1);
			}

			let targetVms = [];
			if (vmId === '-') { // Target all VMs
				if (action === 'suspend') {
					// Suspend only running VMs
					console.log('Checking for running virtual machines to suspend...');
					targetVms = await listRunningVms(vmList, VMWARE_VMRUN_PATH); 

					if (targetVms.length === 0) {
						console.log('No running virtual machines found to suspend.');
						process.exit(0);
					}
				} else { // Resume all configured VMs
					targetVms = vmList;
				}
				console.log(`Initiating ${action} process for ALL specified virtual machines...`);

			} else { // Target a specific VM
				const vmConfig = vmList.find(vm => vm.id === vmId);
				if (!vmConfig) {
					console.error(`Error: Virtual machine with ID "${vmId}" not found. Please check config.json.`);
					process.exit(1);
				}
				targetVms = [vmConfig];
				console.log(`Initiating ${action} process for: ${vmConfig.name} (ID: ${vmId})...`);
			}

			// Execute the action on the target VMs
			await processVmsAction(action, targetVms, VMWARE_VMRUN_PATH);
			break; 

		case "status":
			if (vmId) {
				console.error(`Error: "status" action does not take a VM_ID. Did you mean "status" without an ID?`);
				console.error(`Usage: node vm-manager.js status`);
				process.exit(1);
			}
			console.log('Listing currently running virtual machines...');
			const runningVms = await listRunningVms(vmList, VMWARE_VMRUN_PATH); 
			
			if (runningVms.length === 0) {
				console.log('No virtual machines are currently running.');
			} else {
				console.log('\nCurrently running virtual machines (from config.json):');
				for (const vm of runningVms) {
					console.log(`- ${vm.name} (ID: ${vm.id})`);
				}
			}
			break; 

		default:
			// This case should ideally not be reached due to the initial action validation
			console.error('Error: Unknown action. This should not be reached.');
			process.exit(1);
	}
}

/**
 * Lists currently running virtual machines by querying vmrun and matching against config.
 * @param {Array<Object>} vmList - List of all VMs from config.json.
 * @param {string} vmrunPath - Quoted path to vmrun.exe.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of running VM configurations.
 */
async function listRunningVms(vmList, vmrunPath) {
	const listCommand = `${vmrunPath} list`;

	try {
		const { stdout, stderr } = await executeCommand(listCommand);

		// If vmrun list outputs to stderr, it might indicate no VMs are running,
		// or an actual error. Treat it as no VMs if no stdout is present.
		if (stderr && !stdout.trim()) { 
			return []; 
		}

		const runningVmsPaths = stdout.split('\n')
		                           .slice(1) // Skip header line
		                           .map(line => line.trim())
		                           .filter(line => line); // Filter out empty lines

		const identifiedRunningVms = []; 
		for (const runningPath of runningVmsPaths) {
			const vmConfig = vmList.find(vm => vm.path === runningPath);
			if (vmConfig) {
				identifiedRunningVms.push(vmConfig); 
			} else {
				console.log(`- Warning: Running VM not found in config.json: ${runningPath}`);
			}
		}
		return identifiedRunningVms; 
	} catch (error) {
		console.error(`Failed to list running VMs: ${error.message}`);
		return []; 
	}
}

/**
 * Executes a suspend or resume action on a list of specified virtual machines.
 * @param {string} action - The action to perform ('suspend' or 'resume').
 * @param {Array<Object>} targetVms - Array of VM configurations to process.
 * @param {string} vmrunPath - Quoted path to vmrun.exe.
 */
async function processVmsAction(action, targetVms, vmrunPath) {
	if (targetVms.length === 0) {
		console.log(`No virtual machines found to ${action}.`);
		return;
	}

	console.log(`\nStarting ${action} process for the following virtual machine(s):`);
	for (const vmConfig of targetVms) {
		const vmName = vmConfig.name;
		const vmPath = vmConfig.path;
		let command;
		let successMsg;
		let errorMsg;

		if (action === 'suspend') {
			command = `${vmrunPath} suspend "${vmPath}"`;
			successMsg = `"${vmName}" suspended successfully.`;
			errorMsg = `Failed to suspend "${vmName}".`;
		} else { // action === 'resume'
			command = `${vmrunPath} start "${vmPath}" nogui`;
			successMsg = `"${vmName}" resumed successfully.`;
			errorMsg = `Failed to resume "${vmName}".`;
		}

		console.log(`- ${action === 'suspend' ? 'Suspending' : 'Resuming'} "${vmName}" (ID: ${vmConfig.id})...`);
		try {
			const { stdout, stderr } = await executeCommand(command);
			if (stderr) { // vmrun can output info/warnings to stderr even on success
				if (stderr.includes('Error:')) {
					console.error(`  ${errorMsg} Error: ${stderr.trim()}`);
				} else {
					console.log(`  ${successMsg} (vmrun output: ${stderr.trim()})`); 
				}
			} else {
				console.log(`  ${successMsg}`);
			}
		} catch (error) {
			console.error(`  ${errorMsg} Details: ${error.message}`);
		}
	}
	console.log(`\nAll specified virtual machines ${action} process completed.`);
}

/**
 * Executes a shell command and returns its stdout and stderr.
 * @param {string} command - The command string to execute.
 * @returns {Promise<{stdout: string, stderr: string}>} A promise that resolves with stdout and stderr, or rejects on execution error.
 */
function executeCommand(command) {
	return new Promise((resolve, reject) => {
		exec(command, (error, stdout, stderr) => {
			if (error) {
				reject(error);
			} else {
				resolve({ stdout, stderr });
			}
		});
	});
}

// Execute the script
main();
