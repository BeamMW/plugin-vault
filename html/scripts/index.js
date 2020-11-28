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
        Utils.hide('vault');
        if (this.timeout) {
            clearTimeout(this.timeout);   
        }
        this.timeout = setTimeout(() => {
            this.start();
        }, TIMEOUT)
    }
    
    showVault = () => {
        Utils.setText('cid', this.pluginData.contractId)
        const bigValue = new Big(this.pluginData.balance);
        Utils.setText('in-vault', parseFloat(bigValue.div(GROTHS_IN_BEAM)));
        Utils.show('vault');
    
        Utils.show('deposit');
        this.pluginData.inTransaction ? Utils.hide('buttons') : Utils.show('buttons')
        this.pluginData.balance ? Utils.show('withdraw') : Utils.hide('withdraw');
        this.pluginData.inTransaction ? Utils.show('intx') : Utils.hide('intx');
    
        this.refresh(false);
    }

    start = () => {
        Utils.download("./vaultManager.wasm", function(err, bytes) {
            if (err) {
                let errTemplate = "Failed to load shader,"
                let errMsg = [errTemplate, err].join(" ")
                return setError(errMsg)
            }
    
            Utils.callApi("manager-view", "invoke_contract", {
                contract: bytes,
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
                args: ["role=my_account,action=view,cid=", this.pluginData.contractId].join("")
            })
        }, now ? 0 : TIMEOUT);
    }
    
    parseShaderResult = (apiResult) => {
        if (typeof(apiResult.output) != 'string') {
            throw "Empty shader response"
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
                throw JSON.stringify(apiAnswer.error)
            }
    
            const apiCallId = apiAnswer.id;
            const apiResult = apiAnswer.result;
            if (!apiResult) {
                throw "Failed to call wallet API";
            }
    
            if (apiCallId == "manager-view") {
                const shaderOut = this.parseShaderResult(apiResult);
                if (shaderOut.Cids) {
                    for (var idx = 0; idx < shaderOut.Cids.length; ++idx) {
                        const cid = shaderOut.Cids[idx];
                        if (cid == "7965a18aefaf3050ccd404482eb919f6641daaf111c7c4a7787c2e932942aa91") {
                            this.pluginData.contractId = cid;
                            return this.refresh(true);
                        }
                    }
                }
    
                throw "Failed to verify contract id"
            }
    
            if (apiCallId == "user-view") {
                const errmsg = "Failed to get balance"
                const shaderOut = this.parseShaderResult(apiResult)
                if (!shaderOut.accounts || shaderOut.accounts.length == 0)
                {
                    // no account info, means we've never used contract before
                    this.pluginData.balance = 0;
                } else {                     
                    const accinfo = shaderOut.accounts[0];
                    if (!accinfo.Account || accinfo.AssetID !== 0) {
                        throw errmsg;
                    }
                    this.pluginData.balance = accinfo.Amount;
                }
                
                Utils.callApi("tx-list", "tx_list", {});
                return
            }
    
            if (apiCallId == "tx-list") {
                if (!Array.isArray(apiResult)) {
                    throw ("Failed to get transactions list");
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
    
            if (apiCallId == "user-deposit") {
                return this.refresh(true);
            } else if (apiCallId == "user-withdraw") {
                return this.refresh(true);
            }
        } catch(err) {
            return this.setError(err.toString());
        }
    }
}

Utils.onLoad(async (beamAPI) => {
    let vault = new Vault();
    //Utils.getById('error').style.color = beamAPI.style.validator_error;
    beamAPI.callWalletApiResult.connect(vault.onApiResult);

    Utils.getById('deposit-button-popup').addEventListener('click', (ev) => {
        const bigValue = new Big(Utils.getById('deposit-input').value);
        const value = bigValue.times(GROTHS_IN_BEAM);
        Utils.callApi("user-deposit", "invoke_contract", {
                args: `role=my_account,action=deposit,amount=${parseInt(value)},asset=0,cid=${vault.pluginData.contractId}`
        });
        
        Utils.hide('deposit');
        Utils.hide('withdraw');
        Utils.hide('deposit-popup');
        // don't refresh here, need to wait until previous contract invoke completes
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
            args: `role=my_account,action=withdraw,amount=${vault.pluginData.balance},asset=0,cid=${vault.pluginData.contractId}`
        })
        Utils.hide('deposit');
        Utils.hide('withdraw');
        Utils.hide('withdraw-popup');
        // don't refresh here, need to wait until previous contract invoke completes
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