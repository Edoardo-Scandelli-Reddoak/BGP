/** Dati serializzabili passati dal pannello (server) ai componenti client del magazzino. */

export type WarehouseProduct = {
  productId: number;
  code: string;
  description: string;
  /** Quantità richiesta dal back office. */
  requestedQty: number;
};

export type WarehousePiece = {
  id: number;
  productId: number;
  lengthCm: number;
  widthCm: number;
  quantity: number;
  areaM2: number;
  conditionNote: string | null;
};

export type PieceGroup = {
  productId: number;
  code: string;
  description: string;
  pieces: WarehousePiece[];
  piecesCount: number;
  m2: number;
};
