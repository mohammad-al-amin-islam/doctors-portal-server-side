const express = require('express');
const cors = require('cors');
const app = express();
require('dotenv').config();
const jwt = require('jsonwebtoken');

var nodemailer = require('nodemailer');
var sgTransport = require('nodemailer-sendgrid-transport');


const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
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



// confirm mail sent
var options = {
    auth: {
        api_key: process.env.EMAIL_SENDER_KEY
    }
}

var emailClient = nodemailer.createTransport(sgTransport(options));


//sent mail function
function sendApoinmentMail(booking) {
    const { patientName, treatmentName, date, patientEmail, slot } = booking;
    var email = {
        from: process.env.SENDER_EMAIL,
        to: patientEmail,
        subject: `Confirmation of ${treatmentName} booking  on ${date} at ${slot}`,
        text: `Confirmation of ${treatmentName} booking  on ${date} at ${slot}`,
        html: `
        <div>
            <h3>Dear ${patientName}</h3> 
            <p>Your ${treatmentName} is confirmed</p>       
            <p>Looking forward to see you on ${date} at ${slot}</p>       
            <h3>Our Addresses</h3>
            <h4>Dhaka,Bangladesh</h4>
            <a href="https://doctors-portal-6f2bf.web.app/">Unsubscribe</a>
        </div>
        `
    };

    emailClient.sendMail(email, function (err, info) {
        if (err) {
            console.log(err);
        }
        else {
            console.log('Message sent: ', info);
        }
    });

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

        });

        //booking info using id
        app.get('/booking/:id', verifyJWT, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) }
            const result = await bookingCollection.findOne(query);
            res.send(result);
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

            //send confirmation email
            sendApoinmentMail(booking)
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
        });

        app.post('/create-payment-intent', verifyJWT, async (req, res) => {
            const { price } = req.body;
            const ammount = price * 100;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: ammount,
                currency: 'usd',
                payment_method_types: ['card']
            })
            res.send({
                clientSecret: paymentIntent.client_secret,
            });

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