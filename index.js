const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const jwt = require('jsonwebtoken');

const { MongoClient, ServerApiVersion } = require('mongodb');
const port = process.env.PORT || 5000;



app.use(cors())
app.use(express.json());


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.yuitj.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


function verifyJWT(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) {
        return res.status(401).send({ message: 'Unauthorized' })
    }
    const token = auth.split(' ')[1]
    jwt.verify(token, process.env.ACCESS_SECRET_TOKEN, (err, decoded) => {
        if (err) {
            return res.status(403).send({ message: 'Forbidden' })
        }
        req.decoded = decoded;
        next();
    })
}


async function run() {

    try {
        await client.connect();
        const serviceCollection = client.db("doctor_portal").collection("service");
        const bookingCollection = client.db("doctor_portal").collection("booking");
        const userCollection = client.db("doctor_portal").collection("users");
        const doctorCollection = client.db("doctor_portal").collection("doctors");

        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const requesterInfo = await userCollection.findOne({ email: decodedEmail });
            if (requesterInfo.role === 'admin') {
                next()
            }
            else {
                res.status(403).send({ message: 'Forbidden' })
            }
        }

        app.get('/services', async (req, res) => {
            const query = {}
            const cursor = serviceCollection.find(query).project({ name: 1 });
            const result = await cursor.toArray();
            res.send(result);
        });

        //loading all users
        app.get('/user', verifyJWT, async (req, res) => {
            const user = await userCollection.find().toArray();
            res.send(user);
        });


        //only admin can access admin panell
        app.get('/admin/:email', async (req, res) => {
            const email = req.params.email;
            const user = await userCollection.findOne({ email: email })
            const isAdmin = user?.role === 'admin';
            res.send({ admin: isAdmin });
        })

        //make addmin a user
        app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const updateDoc = {
                $set: { role: 'admin' }
            };
            const result = await userCollection.updateOne(filter, updateDoc);
            res.send(result);

        })

        app.put('/user/:email', async (req, res) => {
            const email = req.params.email;
            const filter = { email: email };
            const user = req.body;
            const options = { upsert: true };
            const updateDoc = {
                $set: user
            };
            const result = await userCollection.updateOne(filter, updateDoc, options);
            const token = jwt.sign({ email: email }, process.env.ACCESS_SECRET_TOKEN, { expiresIn: '1d' })
            res.send({ result, token });
        })

        //available slots finding
        app.get('/available', async (req, res) => {

            const date = req.query.date;

            //load all services
            const services = await serviceCollection.find().toArray();

            //load all booking 
            const query = { date: date }
            const booking = await bookingCollection.find(query).toArray();

            //get booking services
            services.map(service => {
                const serviceBookings = booking.filter(b => b.treatmentName === service.name);
                const booked = serviceBookings.map(s => s.slot);
                // service.booked = serviceBookings.map(s => s.slot);

                const available = service.slots.filter(s => !booked.includes(s));
                service.slots = available;
            })

            res.send(services);
        });

        app.get('/boking', verifyJWT, async (req, res) => {
            const patient = req.query.email;
            const decodedEmail = req.decoded.email;
            if (patient === decodedEmail) {
                const query = { patientEmail: patient }
                const booking = await bookingCollection.find(query).toArray();
                return res.send(booking);
            }
            else {
                return res.status(403).send({ message: 'Forbidden' });
            }

        })

        //for booking add to db
        app.post('/booking', async (req, res) => {
            const booking = req.body;
            const query = { treatmentName: booking.treatmentName, date: booking.date, patientEmail: booking.patientEmail };
            const exist = await bookingCollection.findOne(query);
            if (exist) {
                return res.send({ success: false, booking: exist })
            }
            const result = await bookingCollection.insertOne(booking);
            res.send({ success: true, result });
        });


        //doctor added
        app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
            const data = req.body;
            const result = await doctorCollection.insertOne(data);
            res.send(result);
        })

        //load all doctors info
        app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
            const result = await doctorCollection.find().toArray();
            res.send(result);
        });

        //delete doctor info
        app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const filter = { email: email }
            const result = await doctorCollection.deleteOne(filter);
            res.send(result);
        })

    }
    finally {

    }

}

run().catch(console.dir);



app.get('/', (req, res) => {
    res.send('Doctors portal server running successfully')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})