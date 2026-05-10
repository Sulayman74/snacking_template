/**
 * 💡 weatherInsights — Mapping condition météo → conseil marketing + template push.
 *
 * Focus stratégique : Click & Collect et Upsell produit. Aucune mention de
 * livraison (ce snack n'en propose pas).
 *
 * Chaque entrée fournit :
 *   - icon       : classe FontAwesome
 *   - iconColor  : classe Tailwind (couleur du contexte météo)
 *   - bgGradient : gradient de fond Tailwind pour la card
 *   - title      : libellé court (UI)
 *   - advice     : conseil stratégique (UI)
 *   - template   : { title, message } pré-rempli dans le form push au clic
 *
 * Conditions supportées (cf. weatherService.deriveCondition) :
 *   sunny | cloudy | rainy | snowy | stormy | foggy | cold | hot
 */

const INSIGHTS = {
    sunny: {
        icon: "fa-sun",
        iconColor: "text-yellow-300",
        bgGradient: "from-amber-400 to-orange-500",
        title: "Beau temps, belle journée",
        advice: "Profitez du trafic naturel : poussez vos boissons fraîches et accompagnements en upsell pré-paiement.",
        template: {
            title: "☀️ Pause fraîcheur !",
            message: "Il fait beau aujourd'hui — commandez votre menu en Click & Collect et ajoutez une boisson fraîche en 1 clic.",
        },
    },
    hot: {
        icon: "fa-temperature-high",
        iconColor: "text-red-300",
        bgGradient: "from-orange-500 to-red-500",
        title: "Forte chaleur",
        advice: "Mettez en avant glaces, sodas et boissons fraîches. C'est le moment idéal pour vos campagnes upsell.",
        template: {
            title: "🥵 Trop chaud pour cuisiner ?",
            message: "On s'occupe de tout ! Glaces, boissons fraîches et menu prêt en Click & Collect. Évitez l'attente.",
        },
    },
    cold: {
        icon: "fa-snowflake",
        iconColor: "text-blue-200",
        bgGradient: "from-sky-500 to-blue-700",
        title: "Il fait froid dehors",
        advice: "Offrez une boisson chaude pour motiver le déplacement en Click & Collect. Petite attention, gros impact.",
        template: {
            title: "🥶 Un café offert ?",
            message: "Bravez le froid : pour toute commande récupérée aujourd'hui, votre boisson chaude est offerte.",
        },
    },
    rainy: {
        icon: "fa-cloud-rain",
        iconColor: "text-blue-200",
        bgGradient: "from-slate-500 to-slate-700",
        title: "Pluie sur la ville",
        advice: "Le trafic baisse — relancez vos clients avec une boisson chaude offerte pour motiver le Click & Collect.",
        template: {
            title: "🌧️ Bravez la pluie !",
            message: "Un thé ou un café offert pour toute commande récupérée ce midi. Préparée à votre arrivée.",
        },
    },
    snowy: {
        icon: "fa-snowflake",
        iconColor: "text-white",
        bgGradient: "from-slate-400 to-slate-600",
        title: "Temps de neige",
        advice: "Encouragez le Click & Collect : pas d'attente sur place, repas chaud à emporter immédiatement.",
        template: {
            title: "❄️ Du chaud par ce temps ?",
            message: "Commandez avant d'arriver : on lance votre plat chaud, vous le récupérez sans attendre.",
        },
    },
    stormy: {
        icon: "fa-bolt",
        iconColor: "text-yellow-300",
        bgGradient: "from-slate-700 to-slate-900",
        title: "Orage en cours",
        advice: "Moment compliqué pour sortir — proposez une réduction Click & Collect pour les courageux.",
        template: {
            title: "⚡ Orage ? On s'en occupe !",
            message: "Commande prête en 10 min, à récupérer dès que ça se calme. Pas d'attente sur place.",
        },
    },
    foggy: {
        icon: "fa-smog",
        iconColor: "text-gray-200",
        bgGradient: "from-gray-400 to-gray-600",
        title: "Brouillard",
        advice: "Conditions un peu mornes — boostez l'énergie avec un café offert sur Click & Collect.",
        template: {
            title: "🌫️ Une pause énergie ?",
            message: "Café offert sur votre prochaine commande Click & Collect. À récupérer toute la journée.",
        },
    },
    cloudy: {
        icon: "fa-cloud",
        iconColor: "text-gray-200",
        bgGradient: "from-slate-400 to-slate-600",
        title: "Temps couvert",
        advice: "Journée standard — bon moment pour pousser un upsell dessert ou boisson sur Click & Collect.",
        template: {
            title: "☁️ Envie d'un petit plus ?",
            message: "Commandez en Click & Collect et complétez votre menu avec un dessert. Ajout en 1 clic au panier.",
        },
    },
};

/**
 * Retourne l'insight associé à une condition. Fallback "cloudy" si inconnue.
 * @param {string} condition — sortie de weatherService.deriveCondition
 */
export function getInsight(condition) {
    return INSIGHTS[condition] || INSIGHTS.cloudy;
}
