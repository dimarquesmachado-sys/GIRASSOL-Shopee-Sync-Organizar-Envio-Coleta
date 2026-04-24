# GIRASSOL - Shopee NFe Sync

Servico Node.js que sincroniza NF-e do Bling para Shopee automaticamente,
destravando pedidos que ficam parados em "Organizar Envio" quando o Bling
falha em transmitir a nota fiscal.

## Fluxo

1. Lista pedidos Shopee no Bling com status "Atendido"
2. Verifica na Shopee API se o pedido ainda esta travado
3. Busca o XML da NF-e no Bling
4. Envia para Shopee via API oficial
5. Aciona organizar coleta

## Deploy

Servico hospedado no Render (plano Starter).
