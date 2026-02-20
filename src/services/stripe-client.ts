/**
 * Stripe Client (shared)
 * Centraliza a criação do cliente para evitar divergência de configuração.
 */

import Stripe from "stripe";

let stripeClient: Stripe | null = null;

/**
 * Obtém o Stripe Client com validação de configuração.
 */
export function getStripeClient(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) {
    // TODO: Defina STRIPE_SECRET_KEY no ambiente (.env/Render).
    throw new Error(
      "STRIPE_SECRET_KEY não configurada. Defina a chave da Stripe."
    );
  }

  if (!stripeClient) {
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }

  return stripeClient;
}
