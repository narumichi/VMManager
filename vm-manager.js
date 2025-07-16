const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE_PATH = path.join(__dirname, 'config.json');

async function main() {
    const args = process.argv.slice(2);

    if (args.length !== 2) {
        console.log('Usage: node vm-manager.js <suspend|resume> <VM_ID>');
        console.log('Example: node vm-manager.js resume vm01');
        console.log('Example: node vm-manager.js suspend vm02');
        process.exit(1);
    }

    const action = args[0].toLowerCase(); // 'suspend' or 'resume'
    const vmId = args[1]; // VM ID

    let configData; // 設定ファイル全体を保持する変数
    try {
        const configRaw = fs.readFileSync(CONFIG_FILE_PATH, 'utf8');
        configData = JSON.parse(configRaw);

        // vmrunPath と virtualMachines の存在チェック
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
    const vmConfig = configData.virtualMachines.find(vm => vm.id === vmId);

    if (!vmConfig) {
        console.error(`Error: Virtual machine with ID "${vmId}" not found. Please check config.json.`);
        process.exit(1);
    }

    const vmPath = vmConfig.path;
    const vmName = vmConfig.name;

    let command;
    let successMessage;
    let errorMessage;

    switch (action) {
        case "suspend":
            command = `${VMWARE_VMRUN_PATH} suspend "${vmPath}"`;
            successMessage = `Virtual machine "${vmName}" has been suspended.`;
            errorMessage = `Failed to suspend virtual machine "${vmName}".`;
            break;

        case "resume":
            command = `${VMWARE_VMRUN_PATH} start "${vmPath}" nogui`;
            successMessage = `Virtual machine "${vmName}" has been resumed (started).`;
            errorMessage = `Failed to resume (start) virtual machine "${vmName}".`;
            break;

        default:
            console.error('Error: Action must be either "suspend" or "resume".');
            process.exit(1);
    }

    console.log(`Initiating ${action} process for: ${vmName} (ID: ${vmId})...`);

    try {
        const { stdout, stderr } = await executeCommand(command);
        if (stdout) console.log(`Output:\n${stdout}`);
        if (stderr) {
            console.error(`vmrun error output:\n${stderr}`);
        }

        if (stderr && stderr.includes('Error:')) {
            console.error(errorMessage);
            process.exit(1);
        } else {
            console.log(successMessage);
        }
    } catch (error) {
        console.error(errorMessage);
        console.error(`Details: ${error.message}`);
        console.error(`Node.js internal error details:`, error);
        process.exit(1);
    }
}

// Helper function to wrap command execution in a Promise
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