# DELETE /cp/services/ticketing-api/sale/{saleID}

Cancels a pending ticket sale created via the [sale endpoint](sale.md).

**URL:** `https://api-gateway.cp.pt/cp/services/ticketing-api/sale/{saleID}`

## Headers

- `X-Api-Key: 12547ba7-8c45-45ee-948a-c03cf5be03d1`
- `x-cp-connect-id: 1483ea620b920be6328dcf89e808937a`
- `x-cp-connect-secret: 74bd06d5a2715c64c2f848c5cdb56e6b`

## Response

Returns `200 OK` with a JSON body (exact shape not yet fully explored) on success.

Useful for cleaning up `PENDING` sales created while probing seat availability
(see [find-seats](../../find-seats.ts)) that aren't part of the final chosen
booking.
