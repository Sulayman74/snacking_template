const AppBridge = {
    // 1. Envoyer une info DE la PWA VERS iOS
    sendToNative: (action, data = {}) => {
        // On vérifie si on est bien dans l'app iOS (grâce au canal "goldBridge")
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.goldBridge) {
            window.webkit.messageHandlers.goldBridge.postMessage({
                action: action,
                data: data
            });
        } else {
            // Si on est sur un navigateur web classique, on log juste dans la console
            console.log(`🌐 [Web Mode] Action simulée : ${action}`, data);
        }
    },

    // 2. Recevoir un ordre D'iOS VERS la PWA (ex: clic sur le menu Liquid Glass)
    receiveFromNative: (command, payload) => {
        console.log(`🍏 [iOS Mode] Ordre reçu : ${command}`, payload);
        
        if (command === "navigate") {
            // Modifie cette ligne selon la façon dont ton template gère la navigation.
            // Si tu utilises des ancres HTML classiques :
            window.location.href = payload.path; 
        }
    }
};

// On rend le bridge global pour pouvoir l'appeler de n'importe où
window.AppBridge = AppBridge;