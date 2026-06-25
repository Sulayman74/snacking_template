export default {
  navbar: {
    menu: "La Carte",
    favorites: "Mes Favoris",
    loyalty: "Fidélité",
    myCard: "Ma carte",
    infos: "Infos",
    admin: "Admin",
    order: "Commander",
    quit: "Quitter",
    logout: "Déconnexion",
    theme: "Thème",
    call: "Appeler"
  },
  home: {
    stars: "Nos Stars",
    starsDesc: "Les favoris du moment, validés par la team.",
    viewMenu: "Voir toute la carte"
  },
  cart: {
    title: "Mon Panier",
    empty: "Votre panier est vide 🛒",
    total: "Total",
    checkout: "Valider la commande",
    deliveryFee: "Frais de livraison",
    minimumOrder: "Minimum de commande non atteint ({min} €)",
    itemQuantity: "{quantity} x {name}"
  },
  auth: {
    title: "Connexion",
    email: "Adresse e-mail",
    password: "Mot de passe",
    login: "Se connecter",
    register: "Créer un compte",
    forgotPassword: "Mot de passe oublié ?",
    guestCheckout: "Continuer en tant qu'invité",
    or: "ou",
    errorEmailInvalid: "Adresse e-mail invalide",
    errorPasswordTooShort: "Le mot de passe doit faire au moins 6 caractères",
    googleLogin: "Continuer avec Google",
    forgotShort: "Oublié ?",
    titleWelcome: "Bienvenue !",
    titleRegister: "Créer un compte",
    switchTextLogin: "Pas encore de compte ?",
    switchTextRegister: "Déjà un compte ?"
  },
  tracking: {
    title: "Suivi de Commande",
    status: "Statut",
    orderId: "Commande #{id}",
    eta: "Livraison prévue dans environ {min} min",
    backToHome: "Retour à l'accueil"
  },
  common: {
    close: "Fermer",
    cancel: "Annuler"
  },
  contact: {
    submit: "Envoyer le message",
    fieldPlaceholder: "Email ou Téléphone",
    messagePlaceholder: "Votre message"
  },
  product: {
    share: "Partager à un pote"
  },
  pwa: {
    install: "Installer",
    refresh: "Rafraîchir"
  },
  loyalty: {
    enableNotifications: "ACTIVER LES NOTIFICATIONS 🔔",
    referralButton: "OFFRE UNE FRITE À UN AMI 🍟",
    notificationsBlocked: "Notifications bloquées dans votre navigateur",
    receivePromos: "Recevoir les offres & promos"
  },
  ingredients: {
    sauces: {
      ketchup: "Ketchup",
      mayo: "Mayonnaise",
      algerienne: "Sauce Algérienne",
      samourai: "Sauce Samouraï",
      harissa: "Harissa",
      blanche: "Sauce Blanche",
      andalouse: "Sauce Andalouse",
      bbq: "Sauce BBQ",
      burger: "Sauce Burger",
      curry: "Sauce Curry",
      poivre: "Sauce Poivre"
    },
    items: {
      salad: "Salade",
      tomato: "Tomate",
      onion: "Oignon",
      cheese: "Fromage",
      pickles: "Cornichons",
      bacon: "Bacon",
      egg: "Œuf"
    },
    options: {
      small: "Petit",
      medium: "Moyen",
      large: "Grand",
      fries: "Frites",
      potatoes: "Potatoes",
      softDrink: "Boisson",
      singleProduct: "Produit Seul",
      menuFormula: "Formule Menu"
    }
  },
  toasts: {
    auth: {
      signUpSuccess: "Compte créé ! 🎉",
      signInSuccess: "Ravi de vous revoir ! 👋",
      emailRequired: "Veuillez d'abord taper votre adresse email dans le champ.",
      resetEmailSent: "Un email de réinitialisation vous a été envoyé ! 📧",
      googleSuccess: "Connexion Google réussie ! 🍔",
      signOutSuccess: "Vous êtes déconnecté. À bientôt !",
      errors: {
        weakPassword: "Mot de passe trop court (6 caractères minimum).",
        emailAlreadyInUse: "Un compte existe déjà avec cet email.",
        userNotFound: "Aucun compte lié à cet email.",
        wrongPassword: "Email ou mot de passe incorrect.",
        invalidEmail: "L'adresse email n'est pas valide.",
        invalidCredential: "Email ou mot de passe incorrect.",
        tooManyRequests: "Trop de tentatives. Réessayez dans quelques minutes.",
        networkRequestFailed: "Pas de connexion. Vérifiez votre réseau.",
        popupClosedByUser: "Connexion annulée.",
        popupBlocked: "La fenêtre de connexion a été bloquée. Autorisez les pop-ups.",
        requiresRecentLogin: "Session expirée. Reconnectez-vous.",
        generic: "Une erreur est survenue. Réessayez."
      }
    },
    checkout: {
      emptyCart: "Votre panier est vide",
      deliveryDisabled: "La livraison est désactivée.",
      clickCollectDisabled: "La commande en ligne est désactivée.",
      maintenance: "Service momentanément en maintenance.",
      addressRequired: "Indiquez votre adresse de livraison.",
      outOfZone: "Votre adresse est hors zone de livraison.",
      minOrderRequired: "Minimum {min} € pour la livraison.",
      connectionError: "Connexion impossible, réessayez.",
      loginRequired: "Veuillez vous connecter pour commander",
      paymentSuccess: "Paiement validé ! 🎉",
      paymentTerminalError: "Une erreur est survenue avec le terminal de paiement.",
      orderFinalizeError: "Paiement réussi, mais erreur d'envoi du ticket. Contactez le restaurant.",
      secureConnectionWait: "Veuillez patienter, connexion sécurisée en cours...",
      secureConnectionError: "Erreur de connexion sécurisée au paiement."
    },
    favorites: {
      loginRequired: "Connectez-vous pour enregistrer vos favoris",
      alreadyFavorite: "Déjà dans vos favoris ❤️",
      maxFavorites: "Maximum {max} favoris atteint",
      added: "Ajouté à vos favoris ❤️",
      saveError: "Impossible d'enregistrer ce favori",
      removed: "Retiré de vos favoris",
      removeError: "Impossible de retirer ce favori",
      notFound: "Favori introuvable",
      cartResetAndAdded: "Panier réinitialisé et favori ajouté !",
      productUnavailable: "Ce produit est épuisé pour le moment",
      productMenuRemoved: "Ce produit n'est plus à la carte",
      addedToCartReprice: "Ajouté au panier — le prix a été mis à jour 🛒",
      addedToCart: "Ajouté au panier ! 🛒"
    },
    pwa: {
      online: "Vous êtes de nouveau en ligne ! 🟢",
      offline: "Mode hors-ligne activé. 🟠",
      referralSuccess: "Cadeau activé ! Votre première commande offrira une frite à votre parrain. 🍟"
    },
    reorder: {
      notFound: "Aucune commande récente trouvée",
      unavailable: "Ces produits ne sont plus à la carte",
      itemsSkipped: "{skipped} article{plural} indisponible{plural} non ajouté{plural}",
      success: "Votre dernière commande est dans le panier ! 🛒",
      successReprice: "Panier rempli — certains prix ont été mis à jour 🛒"
    },
    delivery: {
      locationDenied: "Localisation refusée. Saisissez votre adresse ci-dessous.",
      locationFailed: "Localisation impossible. Saisissez votre adresse.",
      searchingAddress: "Recherche de l'adresse…",
      addressNotFound: "Adresse introuvable. Précisez la ville.",
      searchError: "Erreur de recherche d'adresse."
    }
  }
};
