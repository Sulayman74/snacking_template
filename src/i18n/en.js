export default {
  navbar: {
    menu: "The Menu",
    favorites: "My Favorites",
    loyalty: "Loyalty",
    myCard: "My Card",
    infos: "Infos",
    admin: "Admin",
    order: "Order",
    quit: "Quit",
    logout: "Log out",
    theme: "Theme",
    call: "Call"
  },
  home: {
    stars: "Our Stars",
    starsDesc: "Current favorites, approved by the team.",
    viewMenu: "See all menu"
  },
  cart: {
    title: "My Cart",
    empty: "Your cart is empty 🛒",
    total: "Total",
    checkout: "Place order",
    deliveryFee: "Delivery fee",
    minimumOrder: "Minimum order amount not met ({min} €)",
    itemQuantity: "{quantity} x {name}"
  },
  auth: {
    title: "Login",
    email: "Email address",
    password: "Password",
    login: "Log in",
    register: "Create an account",
    forgotPassword: "Forgot password?",
    guestCheckout: "Continue as guest",
    or: "or",
    errorEmailInvalid: "Invalid email address",
    errorPasswordTooShort: "Password must be at least 6 characters",
    googleLogin: "Continue with Google",
    forgotShort: "Forgot?",
    titleWelcome: "Welcome !",
    titleRegister: "Create an account",
    switchTextLogin: "Don't have an account?",
    switchTextRegister: "Already have an account?"
  },
  tracking: {
    title: "Order Tracking",
    status: "Status",
    orderId: "Order #{id}",
    eta: "Estimated delivery in about {min} min",
    backToHome: "Back to home"
  },
  common: {
    close: "Close",
    cancel: "Cancel"
  },
  contact: {
    submit: "Send message",
    fieldPlaceholder: "Email or Phone",
    messagePlaceholder: "Your message"
  },
  product: {
    share: "Share with a friend"
  },
  pwa: {
    install: "Install",
    refresh: "Refresh"
  },
  loyalty: {
    enableNotifications: "ENABLE NOTIFICATIONS 🔔",
    referralButton: "GIVE A FREE FRIES TO A FRIEND 🍟",
    notificationsBlocked: "Notifications blocked in your browser",
    receivePromos: "Receive offers & promotions"
  },
  ingredients: {
    sauces: {
      ketchup: "Ketchup",
      mayo: "Mayonnaise",
      algerienne: "Algerian Sauce",
      samourai: "Samurai Sauce",
      harissa: "Harissa",
      blanche: "White Sauce",
      andalouse: "Andalouse Sauce",
      bbq: "BBQ Sauce",
      burger: "Burger Sauce",
      curry: "Curry Sauce",
      poivre: "Pepper Sauce"
    },
    items: {
      salad: "Salad",
      tomato: "Tomato",
      onion: "Onion",
      cheese: "Cheese",
      pickles: "Pickles",
      bacon: "Bacon",
      egg: "Egg"
    },
    options: {
      small: "Small",
      medium: "Medium",
      large: "Large",
      fries: "Frites",
      potatoes: "Potatoes",
      softDrink: "Drink",
      singleProduct: "Single Product",
      menuFormula: "Menu Formula"
    }
  },
  toasts: {
    auth: {
      signUpSuccess: "Account created! 🎉",
      signInSuccess: "Welcome back! 👋",
      emailRequired: "Please enter your email address first.",
      resetEmailSent: "A reset email has been sent! 📧",
      googleSuccess: "Google connection successful! 🍔",
      signOutSuccess: "You are logged out. See you soon!",
      errors: {
        weakPassword: "Password too short (minimum 6 characters).",
        emailAlreadyInUse: "An account already exists with this email.",
        userNotFound: "No account linked to this email.",
        wrongPassword: "Incorrect email or password.",
        invalidEmail: "Invalid email address.",
        invalidCredential: "Incorrect email or password.",
        tooManyRequests: "Too many attempts. Try again in a few minutes.",
        networkRequestFailed: "No connection. Check your network.",
        popupClosedByUser: "Connection cancelled.",
        popupBlocked: "The login window was blocked. Allow popups.",
        requiresRecentLogin: "Session expired. Please log in again.",
        generic: "An error occurred. Try again."
      }
    },
    checkout: {
      emptyCart: "Your cart is empty",
      deliveryDisabled: "Delivery is disabled.",
      clickCollectDisabled: "Online ordering is disabled.",
      maintenance: "Service temporarily under maintenance.",
      addressRequired: "Provide your delivery address.",
      outOfZone: "Your address is out of our delivery area.",
      minOrderRequired: "Minimum {min} € for delivery.",
      connectionError: "Connection failed, try again.",
      loginRequired: "Please log in to order",
      paymentSuccess: "Payment validated! 🎉",
      paymentTerminalError: "An error occurred with the payment terminal.",
      orderFinalizeError: "Payment successful, but order dispatch failed. Contact the restaurant.",
      secureConnectionWait: "Please wait, secure connection in progress...",
      secureConnectionError: "Secure payment connection error."
    },
    favorites: {
      loginRequired: "Log in to save your favorites",
      alreadyFavorite: "Already in your favorites ❤️",
      maxFavorites: "Maximum {max} favorites reached",
      added: "Added to your favorites ❤️",
      saveError: "Could not save this favorite",
      removed: "Removed from your favorites",
      removeError: "Could not remove this favorite",
      notFound: "Favorite not found",
      cartResetAndAdded: "Cart reset and favorite added !",
      productUnavailable: "This product is currently out of stock",
      productMenuRemoved: "This product is no longer on the menu",
      addedToCartReprice: "Added to cart — the price has been updated 🛒",
      addedToCart: "Added to cart! 🛒"
    },
    pwa: {
      online: "You are back online! 🟢",
      offline: "Offline mode activated. 🟠",
      referralSuccess: "Gift activated! Your first order will give free fries to your referrer. 🍟"
    },
    reorder: {
      notFound: "No recent order found",
      unavailable: "These products are no longer available",
      itemsSkipped: "{skipped} unavailable item{plural} not added",
      success: "Your last order is in the cart! 🛒",
      successReprice: "Cart filled — some prices have been updated 🛒"
    },
    delivery: {
      locationDenied: "Location denied. Enter your address below.",
      locationFailed: "Location unavailable. Enter your address.",
      searchingAddress: "Searching address...",
      addressNotFound: "Address not found. Please specify the city.",
      searchError: "Error searching address."
    }
  }
};
