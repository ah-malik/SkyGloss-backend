import 'reflect-metadata';
import * as mongoose from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('Error: MONGO_URI not found in .env file');
    process.exit(1);
}

// Define Schema directly to avoid NestJS entity complex imports
const AccessCodeSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true },
    targetRole: { type: String, required: true },
    isUsed: { type: Boolean, default: false },
    expiresAt: { type: Date },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    generatedForEmail: { type: String }
}, { timestamps: true });

const UserSchema = new mongoose.Schema({
    email: { type: String, required: true },
    role: { type: String, required: true }
});

const AccessCodeModel = mongoose.model('AccessCode', AccessCodeSchema);
const UserModel = mongoose.model('User', UserSchema);

async function run() {
    console.log('Connecting to MongoDB...');
    try {
        await mongoose.connect(MONGO_URI as string);
        console.log('Connected to MongoDB.');

        const jsonPath = path.join(__dirname, '..', 'access_codes.json');
        if (!fs.existsSync(jsonPath)) {
            console.error(`Error: File not found at ${jsonPath}`);
            process.exit(1);
        }

        const rawData = fs.readFileSync(jsonPath, 'utf8');
        const codes: string[] = JSON.parse(rawData);

        if (!Array.isArray(codes)) {
            console.error('Error: JSON must be an array of strings.');
            process.exit(1);
        }

        console.log(`Found ${codes.length} codes. Starting import...`);

        // Find an admin user
        let admin = await UserModel.findOne({ role: 'admin' });

        if (!admin) {
            console.error('Error: No admin user found in database.');
            process.exit(1);
        }

        console.log(`Associated with Admin: ${admin.email}`);

        const expiresAt = new Date();
        expiresAt.setFullYear(expiresAt.getFullYear() + 2); // Valid for 2 years

        let importedCount = 0;
        let skippedCount = 0;

        // Batch processing
        const batchSize = 100;
        for (let i = 0; i < codes.length; i += batchSize) {
            const batch = codes.slice(i, i + batchSize);

            const batchCodes = batch.map(c => c.trim());
            const existingDocs = await AccessCodeModel.find({ code: { $in: batchCodes } }).select('code');
            const existingSet = new Set(existingDocs.map(doc => doc.code));

            const operations: any[] = [];
            for (const code of batchCodes) {
                if (!existingSet.has(code)) {
                    operations.push({
                        code: code,
                        targetRole: 'shop',
                        generatedBy: admin._id,
                        expiresAt,
                        isUsed: false,
                    });
                    importedCount++;
                } else {
                    skippedCount++;
                }
            }

            if (operations.length > 0) {
                await AccessCodeModel.insertMany(operations);
            }

            console.log(`Processed ${Math.min(i + batchSize, codes.length)}/${codes.length}...`);
        }

        console.log('Import completed!');
        console.log(`Successfully imported: ${importedCount}`);
        console.log(`Skipped (duplicates): ${skippedCount}`);

    } catch (error) {
        console.error('An error occurred:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB.');
    }
}

run();
