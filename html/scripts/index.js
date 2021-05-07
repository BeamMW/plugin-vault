import Utils from "./utils.js"

const TIMEOUT = 3000;
const GROTHS_IN_BEAM = 100000000;
const REJECTED_CALL_ID = -32021;
const IN_PROGRESS_ID = 5;
const CONTRACT_ID = "d9c5d1782b2d2b6f733486be480bb0d8bcf34d5fdc63bbac996ed76af541cc14";

class Vault {
    constructor() {
        this.timeout = undefined;
        this.pluginData = {
            contractId: undefined,
            balance: 0,
            inProgress: false,
            isWithdraw: null
        };
    }

    setError = (errmsg) => {
        let errorElementId = "error-common";
        if (document.getElementById('vault').classList.contains('hidden')) {
            errorElementId = "error-full";
            Utils.show('error-full-container');
        } else {
            Utils.show('error-common');
        }

        Utils.setText(errorElementId, errmsg)
        if (this.timeout) {
            clearTimeout(this.timeout);   
        }
        this.timeout = setTimeout(() => {
            Utils.setText(errorElementId, errmsg)
            this.start();
        }, TIMEOUT)
    }
    
    showVault = () => {
        Utils.setText('cid', "Contract ID: " + this.pluginData.contractId);
        Utils.setText('in-vault', parseFloat(new Big(this.pluginData.balance).div(GROTHS_IN_BEAM)));
        Utils.show('vault');
        Utils.hide('error-full-container');
        Utils.hide('error-common');
        Utils.show('deposit');
        this.pluginData.inProgress ? Utils.show('intx') : Utils.hide('intx');
        if (this.pluginData.inProgress && this.pluginData.isWithdraw) {
            Utils.hide('withdraw')
        } else if (!this.pluginData.inProgress || (this.pluginData.inProgress && !this.pluginData.isWithdraw)) {
            this.pluginData.balance ? Utils.show('withdraw') : Utils.hide('withdraw');
        }

        this.refresh(false);
    }

    start = () => {
        Utils.download("./vaultManager.wasm", (err, bytes) => {
            if (err) {
                let errTemplate = "Failed to load shader,"
                let errMsg = [errTemplate, err].join(" ")
                return this.setError(errMsg)
            }
    
            Utils.callApi("manager-view", "invoke_contract", {
                contract: bytes,
                create_tx: false,
                args: "role=manager,action=view"
            })
        })
    }
    
    refresh = (now) => {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }

        this.timeout = setTimeout(() => {
            Utils.callApi("user-view", "invoke_contract", {
                create_tx: false,
                args: ["role=my_account,action=view,cid=", this.pluginData.contractId].join("")
            })
        }, now ? 0 : TIMEOUT);
    }
    
    parseShaderResult = (apiResult) => {
        if (typeof(apiResult.output) != 'string') {
            throw "Empty shader response";
        }
    
        const shaderOut = JSON.parse(apiResult.output);
        if (shaderOut.error) {
            throw ["Shader error: ", shaderOut.error].join("")
        }
    
        return shaderOut;
    }

    onApiResult = (json) => {
        try {
            const apiAnswer = JSON.parse(json);
            if (apiAnswer.error) {
                if (apiAnswer.error.code == REJECTED_CALL_ID) {
                    return;
                }
                throw JSON.stringify(apiAnswer.error);
            }
    
            const apiCallId = apiAnswer.id;
            const apiResult = apiAnswer.result;
            if (!apiResult) {
                throw "Failed to call wallet API";
            }
    
            if (apiCallId == "manager-view") {
                const shaderOut = this.parseShaderResult(apiResult);
                if (shaderOut.contracts) {
                    for (var idx = 0; idx < shaderOut.contracts.length; ++idx) {
                        const cid = shaderOut.contracts[idx].cid
                        if (cid == CONTRACT_ID) {
                            this.pluginData.contractId = cid;
                            return this.refresh(true);
                        }
                    }
                }
                throw "Failed to verify contract id";
            }
    
            if (apiCallId == "user-view") {
                const shaderOut = this.parseShaderResult(apiResult)
                if (!shaderOut.accounts || shaderOut.accounts.length == 0)
                {
                    // no account info, means we've never used contract before
                    this.pluginData.balance = 0;
                } else {                     
                    const accinfo = shaderOut.accounts[0];
                    if (!accinfo.Account || accinfo.AssetID !== 0) {
                        throw "Failed to get balance";
                    }
                    this.pluginData.balance = accinfo.Amount;
                }
                
                Utils.callApi("tx-list", "tx_list", {});
                return
            }
    
            if (apiCallId == "tx-list") {
                if (!Array.isArray(apiResult)) {
                    throw "Failed to get transactions list";
                }

                this.pluginData.inProgress = true;
                this.pluginData.isWithdraw = false;

                for (let element of apiResult) {
                    if (element["tx_type_string"] == "contract") {
                        const ivdata = element["invoke_data"];
                        let isProgressDetected = false;
                        for (let data of ivdata) {
                            if (data["contract_id"] == this.pluginData.contractId) {
                                const status = element["status"]
                                if (status === IN_PROGRESS_ID) {
                                    isProgressDetected = true;
                                    break;
                                }
                            }
                        };

                        if (isProgressDetected) {
                            this.pluginData.inProgress = true;
                            this.pluginData.isWithdraw = element["comment"] === "withdraw from Vault"; 
                            break;
                        }
                    }
                };
                return this.showVault();
            }
    
            if (apiCallId == "user-deposit" || apiCallId == "user-withdraw") {
                if (apiResult.raw_data === undefined || apiResult.raw_data.length < 1) {
                    throw 'Failed to load raw data';
                }

                Utils.callApi("process_invoke_data", "process_invoke_data", {
                    data: apiResult.raw_data
                });
                return this.refresh(true);
            }  else if (apiCallId == "process_invoke_data") {
                return this.refresh(true);
            }
        } catch(err) {
            return this.setError(err.toString());
        }
    }
}

Utils.onLoad(async (beamAPI) => {
    let vault = new Vault();
    beamAPI.api.callWalletApiResult.connect(vault.onApiResult);

    Utils.getById('deposit-button-popup').addEventListener('click', (ev) => {
        const bigValue = new Big(Utils.getById('deposit-input').value);
        const value = bigValue.times(GROTHS_IN_BEAM);
        Utils.callApi("user-deposit", "invoke_contract", {
            create_tx: false,
            args: `role=my_account,action=deposit,amount=${parseInt(value)},asset=0,cid=${vault.pluginData.contractId}`
        });
        
        Utils.hide('deposit');
        Utils.hide('withdraw');
        Utils.hide('deposit-popup');
        ev.preventDefault();
        return false;
    })

    Utils.getById('deposit').addEventListener('click', (ev) => {
        Utils.show('deposit-popup');
    })
    
    Utils.getById('withdraw').addEventListener('click', (ev) => {
        Utils.show('withdraw-popup');
    })

    Utils.getById('withdraw-button-popup').addEventListener('click', (ev) => {
        Utils.callApi("user-withdraw", "invoke_contract", {
            create_tx: false,
            args: `role=my_account,action=withdraw,amount=${vault.pluginData.balance},asset=0,cid=${vault.pluginData.contractId}`
        })
        Utils.hide('deposit');
        Utils.hide('withdraw');
        Utils.hide('withdraw-popup');
        ev.preventDefault();
        return false;
    })

    Utils.getById('deposit-input').addEventListener('keydown', (event) => {
        const specialKeys = [
            'Backspace', 'Tab', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp',
            'Control', 'Delete', 'F5'
          ];

        if (specialKeys.indexOf(event.key) !== -1) {
            return;
        }

        const current = Utils.getById('deposit-input').value;
        const next = current.concat(event.key);
      
        if (!Utils.handleString(next)) {
            event.preventDefault();
        }
    })

    Utils.getById('deposit-input').addEventListener('paste', (event) => {
        const text = event.clipboardData.getData('text');
        if (!Utils.handleString(text)) {
            event.preventDefault();
        }
    })

    Utils.getById('cancel-button-popup-with').addEventListener('click', (ev) => {
        Utils.hide('withdraw-popup');
    })

    Utils.getById('cancel-button-popup-dep').addEventListener('click', (ev) => {
        Utils.hide('deposit-popup');
    })

    vault.start();
});