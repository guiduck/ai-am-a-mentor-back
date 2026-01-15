/**
 * Creator Terms Service
 * Centralizes creator terms metadata and acceptance checks.
 */

import { db } from "../db";
import { creatorTermsAcceptances } from "../db/schema";
import { and, eq } from "drizzle-orm";

export const CREATOR_TERMS = {
  version: "2025-12-01",
  title: "Termos de Venda para Criadores",
  items: [
    "Ao vender cursos, você aceita a cobrança da comissão da plataforma conforme o seu plano.",
    "Os repasses das vendas ficam pendentes até a conclusão do cadastro no Stripe.",
    "É sua responsabilidade manter os dados de recebimento atualizados.",
  ],
};

/**
 * Get creator acceptance for the current terms version.
 */
export async function getCreatorTermsAcceptance(creatorId: string) {
  return db.query.creatorTermsAcceptances.findFirst({
    where: and(
      eq(creatorTermsAcceptances.creatorId, creatorId),
      eq(creatorTermsAcceptances.termsVersion, CREATOR_TERMS.version)
    ),
  });
}

/**
 * Check if creator accepted the current terms version.
 */
export async function hasAcceptedCreatorTerms(creatorId: string): Promise<boolean> {
  const acceptance = await getCreatorTermsAcceptance(creatorId);
  return !!acceptance;
}
