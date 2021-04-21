import Utils from "./utils.js"

const TIMEOUT = 3000;
const GROTHS_IN_BEAM = 100000000;

class Vault {
    constructor() {
        this.timeout = undefined;
        this.pluginData = {
            contractId: undefined,
            balance: 0,
            inTransaction: true,
        };
    }

    setError = (errmsg) => {
        let errorElementId = "error-common";
        if (document.getElementById('vault').classList.contains('hidden')) {
            errorElementId = "error-full";
            Utils.show('error-full-container');
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
        Utils.setText('cid', "cid: " + this.pluginData.contractId)
        const bigValue = new Big(this.pluginData.balance);
        Utils.setText('in-vault', parseFloat(bigValue.div(GROTHS_IN_BEAM)));
        Utils.hide('error-full-container');
        Utils.show('vault');
        Utils.show('deposit');
        this.pluginData.balance ? Utils.show('withdraw') : Utils.hide('withdraw');
        this.pluginData.inTransaction ? Utils.show('intx') : Utils.hide('intx');
    
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
            const errorMessage = "Empty shader response";
            this.setError(errorMessage);
            throw errorMessage;
        }
    
        const shaderOut = JSON.parse(apiResult.output);
        if (shaderOut.error) {
            const errorMessage = ["Shader error: ", shaderOut.error].join("");
            this.setError(errorMessage);
            throw errorMessage
        }
    
        return shaderOut;
    }

    onApiResult = (json) => {
        try {
            let errorMessage = "";
            const apiAnswer = JSON.parse(json);
            if (apiAnswer.error) {
                this.setError(apiAnswer.error);
                throw JSON.stringify(apiAnswer.error);
            }
    
            const apiCallId = apiAnswer.id;
            const apiResult = apiAnswer.result;
            if (!apiResult) {
                errorMessage = "Failed to call wallet API";
                this.setError(errorMessage);
                throw errorMessage;
            }
    
            if (apiCallId == "manager-view") {
                errorMessage = "Failed to verify contract id";
                const shaderOut = this.parseShaderResult(apiResult);
                if (shaderOut.contracts) {
                    for (var idx = 0; idx < shaderOut.contracts.length; ++idx) {
                        const cid = shaderOut.contracts[idx].cid
                        if (cid == "d9c5d1782b2d2b6f733486be480bb0d8bcf34d5fdc63bbac996ed76af541cc14") {
                            this.pluginData.contractId = cid;
                            return this.refresh(true);
                        }
                    }
                }
    
                this.setError(errorMessage);
                throw errorMessage;
            }
    
            if (apiCallId == "user-view") {
                errorMessage = "Failed to get balance"
                const shaderOut = this.parseShaderResult(apiResult)
                if (!shaderOut.accounts || shaderOut.accounts.length == 0)
                {
                    // no account info, means we've never used contract before
                    this.pluginData.balance = 0;
                } else {                     
                    const accinfo = shaderOut.accounts[0];
                    if (!accinfo.Account || accinfo.AssetID !== 0) {
                        this.setError(errorMessage);
                        throw errorMessage;
                    }
                    this.pluginData.balance = accinfo.Amount;
                }
                
                Utils.callApi("tx-list", "tx_list", {});
                return
            }
    
            if (apiCallId == "tx-list") {
                if (!Array.isArray(apiResult)) {
                    errorMessage = "Failed to get transactions list";
                    this.setError(errorMessage);
                    throw (errorMessage);
                }
    
                let ourActiveTx = (tx) => {
                    if (tx["tx_type_string"] == "contract") {
                        const ivdata = tx["invoke_data"];
                        for (let idx = 0; idx < ivdata.length; ++idx) {
                            if (ivdata[idx]["contract_id"] == this.pluginData.contractId) {
                                const status = tx["status"]
                                if (status == 2 || status == 3 || status == 4) {
                                    // cancelled, completed, failed
                                    continue
                                }
                                return true;
                            }
                        }
                    }
                    return false;
                }

                this.pluginData.inTransaction = false;
                for (let idx = 0; idx < apiResult.length; ++idx) {
                    if (ourActiveTx(apiResult[idx])) {
                        this.pluginData.inTransaction = true;
                        break
                    }
                }
                
                return this.showVault();
            }
    
            if (apiCallId == "user-deposit" || apiCallId == "user-withdraw") {
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