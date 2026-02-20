export class CreateProductGroupDto {
    name: string;
    products: {
        productId: string;
        sizes: { size: string; price: number }[];
    }[];
    isActive?: boolean;
}

export class UpdateProductGroupDto {
    name?: string;
    products?: {
        productId: string;
        sizes: { size: string; price: number }[];
    }[];
    isActive?: boolean;
}
